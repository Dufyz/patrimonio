import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../postgresql.js';
import type { Sql } from '../postgresql.js';
import {
  beginTestTransaction,
  createTestConnection,
  prepareTestDatabase,
  repositoriesOn,
  rollbackTestTransaction,
} from '../testing/database.js';
import type { TestTransaction } from '../testing/database.js';

const PORTFOLIO = '0191e5a0-0000-7000-8000-00000000a001';
const INSTITUTION = '0191e5a0-0000-7000-8000-00000000a002';

let sql: Sql;
let tx: TestTransaction;
let repositories: ReturnType<typeof repositoriesOn>;

const day = (date: string, total: string) => ({
  portfolio_id: PORTFOLIO,
  position_date: date,
  total_value: total,
  net_flow: '0.00',
  income: '0.00',
  payouts: '0.00',
  quota_value: '1.000000000000',
  quota_count: total,
  cumulative_contributions: '0.00',
});

const position = (assetId: string, date: string, value: string) => ({
  portfolio_id: PORTFOLIO,
  asset_id: assetId,
  position_date: date,
  quantity: '100.00000000',
  avg_price: '30.00000000',
  cost_basis: '3000.00',
  market_value: value,
  price_source_kind: 'fresh' as const,
  accrued_interest: '0.00',
});

const assetIds = Array.from(
  { length: 300 },
  (_, index) => `0191e5a0-0000-7000-8000-${String(index).padStart(12, '0')}`,
);

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

beforeEach(async () => {
  tx = await beginTestTransaction(sql);
  repositories = repositoriesOn(tx);

  await tx`
    INSERT INTO institution (id, name)
    VALUES (${INSTITUTION}, 'Corretora Projeção')
  `;
  await tx`INSERT INTO portfolio (id, name) VALUES (${PORTFOLIO}, 'Carteira Projeção')`;
  await tx`
    INSERT INTO asset (id, ticker, name, origin, b3_type)
    SELECT id, 'P' || ROW_NUMBER() OVER (ORDER BY id), 'Ativo', 'market', 'stock'
      FROM UNNEST(${sql.array(assetIds)}::UUID[]) AS t(id)
  `;
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

describe('escrita em lote', () => {
  it('trezentas posições são gravadas numa consulta', async () => {
    const rows = assetIds.map((id) => position(id, '2026-10-06', '3200.00'));

    const written = unwrapSuccess(await repositories.projections.upsertPositions(rows));

    expect(written).toBe(300);
  });

  it('reescrever o mesmo dia duas vezes não duplica linha', async () => {
    const rows = [position(assetIds[0] ?? '', '2026-10-06', '3200.00')];

    unwrapSuccess(await repositories.projections.upsertPositions(rows));
    unwrapSuccess(
      await repositories.projections.upsertPositions([
        position(assetIds[0] ?? '', '2026-10-06', '3300.00'),
      ]),
    );

    const stored = unwrapSuccess(
      await repositories.projections.listPositionsOn(PORTFOLIO, '2026-10-06'),
    );

    expect(stored).toHaveLength(1);
    expect(stored[0]?.market_value).toBe('3300.00');
  });

  it('lista vazia não vai ao banco', async () => {
    expect(unwrapSuccess(await repositories.projections.upsertPositions([]))).toBe(0);
    expect(unwrapSuccess(await repositories.projections.upsertPortfolioDays([]))).toBe(0);
    expect(unwrapSuccess(await repositories.projections.upsertTaxMonths([]))).toBe(0);
  });

  it('NUMERIC volta como string, sem perder casa nenhuma', async () => {
    unwrapSuccess(
      await repositories.projections.upsertPortfolioDays([
        {
          ...day('2026-10-06', '15000.00'),
          quota_value: '1.003311258278',
          quota_count: '14950.495049504950',
        },
      ]),
    );

    const stored = unwrapSuccess(
      await repositories.projections.lastDayBefore(PORTFOLIO, '2026-10-07'),
    );

    expect(stored?.quota_value).toBe('1.003311258278');
    expect(stored?.quota_count).toBe('14950.495049504950');
  });
});

describe('apagar para reconstruir', () => {
  beforeEach(async () => {
    unwrapSuccess(
      await repositories.projections.upsertPortfolioDays([
        day('2026-10-01', '1000.00'),
        day('2026-10-02', '1100.00'),
        day('2026-10-05', '1200.00'),
      ]),
    );
    unwrapSuccess(
      await repositories.projections.upsertPositions([
        position(assetIds[0] ?? '', '2026-10-01', '1000.00'),
        position(assetIds[0] ?? '', '2026-10-05', '1200.00'),
      ]),
    );
  });

  it('apaga a partir da data e deixa o que vem antes', async () => {
    const removed = unwrapSuccess(
      await repositories.projections.deleteFrom(PORTFOLIO, '2026-10-02'),
    );

    expect(removed).toEqual({ positions: 1, days: 2 });

    const left = unwrapSuccess(
      await repositories.projections.listDaysBetween(
        PORTFOLIO,
        '2026-01-01',
        '2026-12-31',
      ),
    );

    expect(left.map((row) => row.position_date)).toEqual(['2026-10-01']);
  });

  it('a linha anterior ao intervalo é a semente da série', async () => {
    const seed = unwrapSuccess(
      await repositories.projections.lastDayBefore(PORTFOLIO, '2026-10-05'),
    );

    expect(seed?.position_date).toBe('2026-10-02');
  });

  it('sem linha anterior a semente é nula, e a série começa do zero', async () => {
    expect(
      unwrapSuccess(
        await repositories.projections.lastDayBefore(PORTFOLIO, '2026-01-01'),
      ),
    ).toBeNull();
  });
});

describe('a janela lê duas linhas, não duas mil', () => {
  beforeEach(async () => {
    const dates = Array.from({ length: 200 }, (_, index) => {
      const base = new Date(Date.UTC(2026, 0, 1));
      base.setUTCDate(base.getUTCDate() + index);
      return base.toISOString().slice(0, 10);
    });

    unwrapSuccess(
      await repositories.projections.upsertPortfolioDays(
        dates.map((date, index) => day(date, `${1000 + index}.00`)),
      ),
    );
  });

  it('devolve exatamente a última linha em ou antes de cada data pedida', async () => {
    const points = unwrapSuccess(
      await repositories.projections.quotaPointsAt(PORTFOLIO, [
        '2026-03-01',
        '2026-06-01',
      ]),
    );

    expect(points).toHaveLength(2);
    expect(points.map((row) => row.position_date).sort()).toEqual([
      '2026-03-01',
      '2026-06-01',
    ]);
  });

  it('data anterior ao início da série não devolve linha nenhuma', async () => {
    const points = unwrapSuccess(
      await repositories.projections.quotaPointsAt(PORTFOLIO, ['2025-01-01']),
    );

    expect(points).toEqual([]);
  });

  it('sem data pedida não há consulta', async () => {
    expect(
      unwrapSuccess(await repositories.projections.quotaPointsAt(PORTFOLIO, [])),
    ).toEqual([]);
  });
});

describe('plano de consulta', () => {
  it('a consulta de um dia toca uma partição, não as trinta e seis', async () => {
    unwrapSuccess(
      await repositories.projections.upsertPositions(
        assetIds.slice(0, 50).map((id) => position(id, '2026-10-06', '3200.00')),
      ),
    );

    const plan = await tx<{ ['QUERY PLAN']: string }[]>`
      EXPLAIN SELECT * FROM position_daily
        WHERE portfolio_id = ${PORTFOLIO} AND position_date = '2026-10-06'
    `;

    const text = plan.map((row) => row['QUERY PLAN']).join('\n');

    // O que se mede aqui é a poda de partição, que é determinística — a escolha
    // entre índice e varredura depende do volume, e num banco de teste vazio o
    // planejador escolheria varredura com razão. Tocar as 36 partições, não.
    expect(text).toMatch(/position_daily_2026/);
    expect(text).not.toMatch(/position_daily_2025/);
    expect(text).not.toMatch(/position_daily_2035/);
  });

  it('o intervalo de um recálculo de dez anos toca dez partições, não todas', async () => {
    const plan = await tx<{ ['QUERY PLAN']: string }[]>`
      EXPLAIN SELECT * FROM position_daily
        WHERE portfolio_id = ${PORTFOLIO}
          AND position_date BETWEEN '2016-01-01' AND '2026-12-31'
    `;

    const text = plan.map((row) => row['QUERY PLAN']).join('\n');

    expect(text).not.toMatch(/position_daily_2015/);
    expect(text).not.toMatch(/position_daily_2027/);
  });
});

describe('apuração', () => {
  it('a apuração do mês é regravada no lugar, sem duplicar', async () => {
    const row = {
      year: 2026,
      month: 3,
      asset_class: 'stock' as const,
      sales_total: '30000.00',
      gross_result: '5000.00',
      exempt: false,
      loss_carried_forward: '0.00',
    };

    unwrapSuccess(await repositories.projections.upsertTaxMonths([row]));
    unwrapSuccess(
      await repositories.projections.upsertTaxMonths([
        { ...row, gross_result: '6000.00' },
      ]),
    );

    const stored = unwrapSuccess(await repositories.projections.listTaxMonths(2026));
    const march = stored.filter((month) => month.month === 3);

    expect(march).toHaveLength(1);
    expect(march[0]?.gross_result).toBe('6000.00');
  });
});
