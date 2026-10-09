import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../postgresql.js';
import type { Connection, Sql } from '../postgresql.js';
import {
  beginTestTransaction,
  createTestConnection,
  prepareTestDatabase,
  rollbackTestTransaction,
} from '../testing/database.js';
import type { TestTransaction } from '../testing/database.js';
import { createOverviewRepository } from './overview.repository.js';

const LONGO = '0191e5a0-0000-7000-8000-00000000b001';
const RESERVA = '0191e5a0-0000-7000-8000-00000000b002';
const ACOES = '0191e5a0-0000-7000-8000-00000000b010';
const FIIS = '0191e5a0-0000-7000-8000-00000000b011';
const ITUB4 = '0191e5a0-0000-7000-8000-00000000b020';
const HGLG11 = '0191e5a0-0000-7000-8000-00000000b021';

let sql: Sql;
let tx: TestTransaction;

/**
 * A consulta da visão geral é uma só, de propósito — o banco fica em outra
 * rede, e cada leitura a mais aparece na abertura da tela. Contar as chamadas
 * é a única forma de essa decisão não se desfazer sozinha no primeiro "só
 * mais um select".
 */
const counting = (
  connection: TestTransaction,
): { readonly connection: Connection; readonly calls: () => number } => {
  let calls = 0;

  const proxy = new Proxy(connection, {
    apply: (target, thisArg, args: unknown[]) => {
      calls += 1;
      return Reflect.apply(target as never, thisArg, args);
    },
  });

  return { connection: proxy as unknown as Connection, calls: () => calls };
};

const day = (
  portfolio: string,
  date: string,
  total: string,
  overrides: Record<string, string> = {},
) => ({
  portfolio_id: portfolio,
  position_date: date,
  total_value: total,
  net_flow: overrides['net_flow'] ?? '0.00',
  income: overrides['income'] ?? '0.00',
  payouts: overrides['payouts'] ?? '0.00',
  quota_value: overrides['quota_value'] ?? '1.000000000000',
  quota_count: overrides['quota_count'] ?? total,
  cumulative_contributions: overrides['cumulative_contributions'] ?? '0.00',
});

const writeDays = async (rows: readonly ReturnType<typeof day>[]): Promise<void> => {
  for (const row of rows) {
    await tx`
      insert into portfolio_daily ${tx(
        row,
        'portfolio_id',
        'position_date',
        'total_value',
        'net_flow',
        'income',
        'payouts',
        'quota_value',
        'quota_count',
        'cumulative_contributions',
      )}
    `;
  }
};

const writePosition = async (
  portfolio: string,
  asset: string,
  date: string,
  value: string,
  kind: 'fresh' | 'stale' | 'manual' | 'missing' = 'fresh',
  quantity = '100.00000000',
): Promise<void> => {
  await tx`
    insert into position_daily (
      portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
      market_value, price_source_kind, accrued_interest
    )
    values (
      ${portfolio}, ${asset}, ${date}, ${quantity}, '30.00000000', '3000.00',
      ${value}, ${kind}::computed_price_kind, '0.00'
    )
  `;
};

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

beforeEach(async () => {
  tx = await beginTestTransaction(sql);

  await tx`
    insert into portfolio (id, name, tolerance_pp, sort_order)
    values (${LONGO}, 'Longo prazo', '3', 1), (${RESERVA}, 'Reserva', '5', 2)
  `;
  await tx`
    insert into category (id, name, color_token, sort_order)
    values (${ACOES}, 'Ações', 'class.acoes', 1), (${FIIS}, 'FIIs', 'class.fiis', 2)
  `;
  await tx`
    insert into asset (id, ticker, name, origin, b3_type, category_id)
    values
      (${ITUB4}, 'ITUB4', 'Itaú Unibanco PN', 'market', 'stock', ${ACOES}),
      (${HGLG11}, 'HGLG11', 'CSHG Logística', 'market', 'fii', ${FIIS})
  `;
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

describe('o instantâneo da tela de abertura', () => {
  it('lê a tela inteira numa consulta só', async () => {
    const counter = counting(tx);
    const repository = createOverviewRepository(counter.connection);

    await writeDays([day(LONGO, '2026-10-01', '10000.00')]);

    unwrapSuccess(
      await repository.snapshot({
        portfolio_id: LONGO,
        on_date: '2026-10-02',
        from: '2026-09-01',
        to: '2026-10-02',
      }),
    );

    expect(counter.calls()).toBe(1);
  });

  it('a data de referência é o último fechamento, não a data pedida', async () => {
    const repository = createOverviewRepository(tx);

    await writeDays([
      day(LONGO, '2026-10-01', '10000.00'),
      day(LONGO, '2026-10-02', '10100.00'),
    ]);

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: LONGO,
        // Sábado: o último fechamento é o de sexta.
        on_date: '2026-10-04',
        from: '2026-10-01',
        to: '2026-10-04',
      }),
    );

    expect(snapshot.reference_date).toBe('2026-10-02');
    expect(snapshot.inception).toBe('2026-10-01');
  });

  it('o consolidado soma as carteiras no mesmo dia', async () => {
    const repository = createOverviewRepository(tx);

    await writeDays([
      day(LONGO, '2026-10-02', '10000.00'),
      day(RESERVA, '2026-10-02', '2500.00'),
    ]);

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: null,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(snapshot.days.at(-1)?.total_value).toBe('12500.00');
    // Cota consolidada não existe: somar cota de carteiras diferentes não
    // significa nada, e o nulo é o que obriga quem lê a dizer o método.
    expect(snapshot.days.at(-1)?.quota_value).toBeNull();
  });

  it('com escopo de carteira, a cota gravada vem junto', async () => {
    const repository = createOverviewRepository(tx);

    await writeDays([
      day(LONGO, '2026-10-02', '10000.00', { quota_value: '1.003311258278' }),
    ]);

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: LONGO,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(snapshot.days.at(-1)?.quota_value).toBe('1.003311258278');
  });

  it('os três fechamentos de referência saem da mesma consulta', async () => {
    const repository = createOverviewRepository(tx);

    await writeDays([
      day(LONGO, '2026-09-28', '9000.00'),
      day(LONGO, '2026-09-30', '9500.00'),
      day(LONGO, '2026-10-01', '9800.00'),
      day(LONGO, '2026-10-02', '10000.00'),
    ]);

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: LONGO,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(snapshot.anchors.previous_day?.position_date).toBe('2026-10-01');
    expect(snapshot.anchors.month_base?.total_value).toBe('9500.00');
    expect(snapshot.anchors.window_base?.position_date).toBe('2026-09-30');
  });

  it('o valor da posição vem em string, sem passar por ponto flutuante', async () => {
    const repository = createOverviewRepository(tx);

    await writeDays([
      day(LONGO, '2026-10-02', '90071992547409.93', { quota_count: '1.000000000000' }),
    ]);
    await writePosition(LONGO, ITUB4, '2026-10-02', '90071992547409.93');

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: LONGO,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(snapshot.positions[0]?.value).toBe('90071992547409.93');
  });

  it('posição zerada no dia não é posição', async () => {
    const repository = createOverviewRepository(tx);

    await writeDays([day(LONGO, '2026-10-02', '0.00')]);
    await writePosition(LONGO, ITUB4, '2026-10-02', '0.00', 'fresh', '0.00000000');

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: LONGO,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(snapshot.positions).toEqual([]);
  });

  it('o papel sem preço em uma das carteiras chega sem preço na tela', async () => {
    const repository = createOverviewRepository(tx);

    await writeDays([
      day(LONGO, '2026-10-02', '3000.00'),
      day(RESERVA, '2026-10-02', '3000.00'),
    ]);
    await writePosition(LONGO, ITUB4, '2026-10-02', '3000.00', 'fresh');
    await writePosition(RESERVA, ITUB4, '2026-10-02', '3000.00', 'missing');

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: null,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(snapshot.positions[0]?.price_source_kind).toBe('missing');
    expect(snapshot.positions[0]?.value).toBe('6000.00');
  });

  it('carteira com recálculo atrasado entra com o último dia que ela tem', async () => {
    const repository = createOverviewRepository(tx);

    await writeDays([
      day(LONGO, '2026-10-02', '10000.00'),
      day(RESERVA, '2026-09-29', '2000.00'),
    ]);
    await writePosition(LONGO, ITUB4, '2026-10-02', '10000.00');
    await writePosition(RESERVA, HGLG11, '2026-09-29', '2000.00');

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: null,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(snapshot.positions.map((row) => row.ticker)).toEqual(['ITUB4', 'HGLG11']);
    expect(
      snapshot.portfolios.find((row) => row.portfolio_id === RESERVA)?.total_value,
    ).toBe('2000.00');
  });

  it('a composição sai por categoria, com o token de cor que a tela usa', async () => {
    const repository = createOverviewRepository(tx);

    await writeDays([day(LONGO, '2026-10-02', '13000.00')]);
    await writePosition(LONGO, ITUB4, '2026-10-02', '10000.00');
    await writePosition(LONGO, HGLG11, '2026-10-02', '3000.00');

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: LONGO,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(snapshot.categories.map((row) => [row.category_name, row.color_token])).toEqual(
      [
        ['Ações', 'class.acoes'],
        ['FIIs', 'class.fiis'],
      ],
    );
  });

  it('ativo sem categoria aparece como sem categoria, em vez de sumir do total', async () => {
    const repository = createOverviewRepository(tx);

    await tx`update asset set category_id = null where id = ${ITUB4}`;
    await writeDays([day(LONGO, '2026-10-02', '10000.00')]);
    await writePosition(LONGO, ITUB4, '2026-10-02', '10000.00');

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: LONGO,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(snapshot.categories).toEqual([
      {
        category_id: 'sem-categoria',
        category_name: 'Sem categoria',
        group_id: null,
        group_name: null,
        color_token: 'class.outros',
        value: '10000.00',
      },
    ]);
  });

  it('o alvo lido é o da carteira do escopo; o consolidado não tem alvo', async () => {
    const repository = createOverviewRepository(tx);

    await tx`
      insert into strategy_target (portfolio_id, category_id, target_pct)
      values (${LONGO}, ${ACOES}, '60'), (${LONGO}, ${FIIS}, '40')
    `;
    await writeDays([day(LONGO, '2026-10-02', '10000.00')]);

    const scoped = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: LONGO,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );
    const consolidated = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: null,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(scoped.targets).toHaveLength(2);
    expect(consolidated.targets).toEqual([]);
  });

  it('carteira sem fechamento nenhum devolve vazio, não erro', async () => {
    const repository = createOverviewRepository(tx);

    const snapshot = unwrapSuccess(
      await repository.snapshot({
        portfolio_id: LONGO,
        on_date: '2026-10-02',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(snapshot.reference_date).toBeNull();
    expect(snapshot.days).toEqual([]);
    expect(snapshot.anchors.previous_day).toBeNull();
    expect(
      snapshot.portfolios.find((row) => row.portfolio_id === LONGO)?.total_value,
    ).toBeNull();
  });
});
