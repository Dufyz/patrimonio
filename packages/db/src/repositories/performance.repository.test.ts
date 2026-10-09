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
import { createPerformanceRepository } from './performance.repository.js';

const LONGO = '0191e5a0-0000-7000-8000-00000000c001';
const RESERVA = '0191e5a0-0000-7000-8000-00000000c002';
const ARQUIVADA = '0191e5a0-0000-7000-8000-00000000c003';
const ACOES = '0191e5a0-0000-7000-8000-00000000c010';
const FIIS = '0191e5a0-0000-7000-8000-00000000c011';
const CAIXA_CATEGORIA = '0191e5a0-0000-7000-8000-00000000c012';
const ITUB4 = '0191e5a0-0000-7000-8000-00000000c020';
const HGLG11 = '0191e5a0-0000-7000-8000-00000000c021';
const CAIXA = '0191e5a0-0000-7000-8000-00000000c022';
const CORRETORA = '0191e5a0-0000-7000-8000-00000000c030';

let sql: Sql;
let tx: TestTransaction;

/**
 * Cada leitura é uma consulta, de propósito: o banco fica em outra rede, e
 * contar as chamadas é a única forma de a decisão não se desfazer sozinha no
 * primeiro "só mais um select".
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

const close = async (
  portfolio: string,
  date: string,
  total: string,
  quota: string,
  flow = '0.00',
): Promise<void> => {
  await tx`
    insert into portfolio_daily (
      portfolio_id, position_date, total_value, net_flow, income, payouts,
      quota_value, quota_count, cumulative_contributions
    )
    values (${portfolio}, ${date}, ${total}, ${flow}, '0.00', '0.00', ${quota}, '1000', '0.00')
  `;
};

const hold = async (
  portfolio: string,
  asset: string,
  date: string,
  value: string,
): Promise<void> => {
  await tx`
    insert into position_daily (
      portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
      market_value, price_source_kind, accrued_interest
    )
    values (${portfolio}, ${asset}, ${date}, '100', '10', '1000.00', ${value}, 'fresh', '0.00')
  `;
};

type Entry = {
  readonly id: number;
  readonly kind: string;
  readonly date: string;
  readonly portfolio?: string;
  readonly asset: string;
  readonly net: string;
  readonly payoutKind?: string;
  readonly confirmed?: boolean;
};

const record = async (entry: Entry): Promise<void> => {
  await tx`
    insert into transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id, institution_id,
       quantity, unit_price, fees, gross_amount, net_amount, payout_kind, confirmed_at,
       transfer_group_id)
    values
      (${`0191e5a0-0000-7000-8000-0000000d${String(entry.id).padStart(4, '0')}`},
       ${entry.kind}::transaction_kind, ${entry.date}, ${entry.date},
       ${entry.portfolio ?? LONGO}, ${entry.asset}, ${CORRETORA}, '1', '1', '0',
       ${entry.net}, ${entry.net}, ${entry.payoutKind ?? null}::payout_kind,
       ${entry.confirmed === false ? null : tx`now()`},
       ${entry.kind === 'transfer' ? '0191e5a0-0000-7000-8000-0000000e0001' : null})
  `;
};

const factors = async (
  code: string,
  from: string,
  to: string,
  daily: string,
): Promise<void> => {
  await tx`
    insert into index_quote (index_code, quote_date, daily_factor, raw_value, source)
    select ${code}, calendar_date, ${daily}, '0', 'teste'
      from business_day
     where is_business_day and calendar_date between ${from}::date and ${to}::date
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
    insert into portfolio (id, name, purpose, sort_order, archived_at)
    values
      (${LONGO}, 'Longo prazo', 'independência', 1, null),
      (${RESERVA}, 'Reserva', null, 2, null),
      (${ARQUIVADA}, 'Antiga', null, 3, now())
  `;
  await tx`
    insert into category (id, name, color_token, sort_order)
    values
      (${ACOES}, 'Ações', 'class.acoes', 1),
      (${FIIS}, 'FIIs', 'class.fiis', 2),
      (${CAIXA_CATEGORIA}, 'Caixa', 'class.caixa', 3)
  `;
  await tx`
    insert into asset (id, ticker, name, origin, b3_type, category_id)
    values
      (${ITUB4}, 'ITUB4', 'Itaú Unibanco PN', 'market', 'stock', ${ACOES}),
      (${HGLG11}, 'HGLG11', 'CSHG Logística', 'market', 'fii', ${FIIS}),
      (${CAIXA}, 'CAIXA-A', 'Caixa · Corretora A', 'market', 'cash', ${CAIXA_CATEGORIA})
  `;
  await tx`
    insert into institution (id, name, role)
    values (${CORRETORA}, 'Corretora A', 'custodian')
  `;
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

describe('o instantâneo de desempenho', () => {
  it('lê o escopo e o catálogo numa consulta só', async () => {
    const counter = counting(tx);
    const repository = createPerformanceRepository(counter.connection);

    await close(LONGO, '2026-06-30', '10000.00', '1.000000000000');

    unwrapSuccess(
      await repository.snapshot({ portfolio_id: LONGO, on_date: '2026-06-30' }),
    );

    expect(counter.calls()).toBe(1);
  });

  it('devolve a história inteira até a referência, em ordem de data', async () => {
    const repository = createPerformanceRepository(tx);

    await close(LONGO, '2026-03-31', '10000.00', '1.000000000000');
    await close(LONGO, '2026-05-29', '10500.00', '1.050000000000');
    await close(LONGO, '2026-06-30', '11000.00', '1.100000000000');
    // Depois da data pedida: não existe ainda para esta leitura.
    await close(LONGO, '2026-07-31', '12000.00', '1.200000000000');

    const snapshot = unwrapSuccess(
      await repository.snapshot({ portfolio_id: LONGO, on_date: '2026-06-30' }),
    );

    expect(snapshot.reference_date).toBe('2026-06-30');
    expect(snapshot.inception).toBe('2026-03-31');
    expect(snapshot.days.map((day) => day.position_date)).toEqual([
      '2026-03-31',
      '2026-05-29',
      '2026-06-30',
    ]);
  });

  it('a referência é o último fechamento, não a data pedida', async () => {
    const repository = createPerformanceRepository(tx);

    await close(LONGO, '2026-06-30', '11000.00', '1.100000000000');

    const snapshot = unwrapSuccess(
      await repository.snapshot({ portfolio_id: LONGO, on_date: '2026-07-04' }),
    );

    expect(snapshot.reference_date).toBe('2026-06-30');
  });

  it('com uma carteira vem a cota gravada; no consolidado ela é nula', async () => {
    const repository = createPerformanceRepository(tx);

    await close(LONGO, '2026-06-30', '11000.00', '1.100000000000');
    await close(RESERVA, '2026-06-30', '2000.00', '1.020000000000');

    const scoped = unwrapSuccess(
      await repository.snapshot({ portfolio_id: LONGO, on_date: '2026-06-30' }),
    );
    const all = unwrapSuccess(
      await repository.snapshot({ portfolio_id: null, on_date: '2026-06-30' }),
    );

    expect(scoped.days[0]?.quota_value).toBe('1.100000000000');
    expect(all.days[0]?.quota_value).toBeNull();
    // Somar cota de carteiras diferentes não significa nada: o total soma, a
    // cota não.
    expect(all.days[0]?.total_value).toBe('13000.00');
  });

  it('lista as carteiras ativas, cada uma no último fechamento que tem', async () => {
    const repository = createPerformanceRepository(tx);

    await close(LONGO, '2026-06-30', '11000.00', '1.100000000000');
    await close(RESERVA, '2026-06-26', '2000.00', '1.020000000000');
    await close(ARQUIVADA, '2026-06-30', '999.00', '1.000000000000');

    const snapshot = unwrapSuccess(
      await repository.snapshot({ portfolio_id: null, on_date: '2026-06-30' }),
    );

    expect(snapshot.portfolios.map((row) => [row.name, row.total_value])).toEqual([
      ['Longo prazo', '11000.00'],
      ['Reserva', '2000.00'],
    ]);
  });

  it('o catálogo traz os benchmarks de referência com a definição como o banco guarda', async () => {
    const repository = createPerformanceRepository(tx);

    const snapshot = unwrapSuccess(
      await repository.snapshot({ portfolio_id: null, on_date: '2026-06-30' }),
    );
    const cdi = snapshot.benchmarks.find((row) => row.name === 'CDI');

    expect(cdi).toMatchObject({ kind: 'index', rebalance: 'never' });
    expect(cdi?.definition).toEqual({ index: 'CDI' });
    expect(snapshot.benchmarks.map((row) => row.name)).toEqual(
      expect.arrayContaining(['CDI', 'Selic', 'IPCA', 'Ibovespa', 'IFIX']),
    );
  });

  it('antes do primeiro fechamento a resposta é vazia, não erro', async () => {
    const repository = createPerformanceRepository(tx);

    const snapshot = unwrapSuccess(
      await repository.snapshot({ portfolio_id: LONGO, on_date: '2026-06-30' }),
    );

    expect(snapshot.reference_date).toBeNull();
    expect(snapshot.inception).toBeNull();
    expect(snapshot.days).toEqual([]);
  });
});

describe('o detalhamento', () => {
  const query = {
    portfolio_id: LONGO as string | null,
    reference: '2026-06-30',
    points: [
      { label: 'month', date: '2026-05-29' },
      { label: 'inception', date: '2026-03-31' },
      { label: 'reference', date: '2026-06-30' },
    ],
    index_codes: [],
    factors_from: '2026-03-31',
    flows_from: '2026-03-31',
  } as const;

  it('lê tudo numa consulta só', async () => {
    const counter = counting(tx);
    const repository = createPerformanceRepository(counter.connection);

    unwrapSuccess(await repository.breakdown(query));

    expect(counter.calls()).toBe(1);
  });

  describe('fatores de índice', () => {
    beforeEach(async () => {
      await factors('CDI', '2026-03-30', '2026-06-30', '1.000400000000');
      await factors('IBOV', '2026-03-30', '2026-06-30', '1.001000000000');
    });

    it('traz só os índices pedidos, depois da data inicial e até a referência', async () => {
      const repository = createPerformanceRepository(tx);

      const result = unwrapSuccess(
        await repository.breakdown({ ...query, index_codes: ['CDI'] }),
      );

      expect([...result.factors.keys()]).toEqual(['CDI']);

      const dates = [...(result.factors.get('CDI')?.keys() ?? [])].sort();

      // A data inicial fica de fora: é a base, e o fator dela já é de ontem.
      expect(dates[0]).toBe('2026-04-01');
      expect(dates.at(-1)).toBe('2026-06-30');
      expect(result.factors.get('CDI')?.get('2026-04-01')).toBe('1.000400000000');
    });

    it('sem índice pedido não lê fator nenhum', async () => {
      const repository = createPerformanceRepository(tx);

      const result = unwrapSuccess(await repository.breakdown(query));

      expect(result.factors.size).toBe(0);
    });
  });

  describe('a cota de cada carteira em cada ponto', () => {
    beforeEach(async () => {
      await close(LONGO, '2026-03-31', '10000.00', '1.000000000000');
      await close(LONGO, '2026-05-29', '10500.00', '1.050000000000');
      await close(LONGO, '2026-06-30', '11000.00', '1.100000000000');
      // A Reserva abriu em junho: o início dela não é o do escopo.
      await close(RESERVA, '2026-06-15', '2000.00', '1.000000000000');
      await close(RESERVA, '2026-06-30', '2100.00', '1.050000000000');
    });

    const point = async (portfolio: string, label: string) => {
      const result = unwrapSuccess(
        await createPerformanceRepository(tx).breakdown({ ...query, portfolio_id: null }),
      );

      return result.portfolio_points.find(
        (row) => row.portfolio_id === portfolio && row.label === label,
      );
    };

    it('é a última cota em ou antes da data do ponto', async () => {
      expect(await point(LONGO, 'month')).toMatchObject({
        position_date: '2026-05-29',
        quota_value: '1.050000000000',
      });
      expect(await point(LONGO, 'reference')).toMatchObject({
        position_date: '2026-06-30',
        quota_value: '1.100000000000',
      });
    });

    it('o início é o primeiro fechamento de cada carteira, não o do escopo', async () => {
      expect(await point(LONGO, 'inception')).toMatchObject({
        position_date: '2026-03-31',
        quota_value: '1.000000000000',
      });
      expect(await point(RESERVA, 'inception')).toMatchObject({
        position_date: '2026-06-15',
        quota_value: '1.000000000000',
      });
    });

    it('carteira que ainda não existia na data volta sem linha, e isso é traço', async () => {
      expect(await point(RESERVA, 'month')).toMatchObject({
        position_date: null,
        quota_value: null,
      });
    });

    it('carteira arquivada não entra', async () => {
      await close(ARQUIVADA, '2026-06-30', '999.00', '1.000000000000');

      const result = unwrapSuccess(
        await createPerformanceRepository(tx).breakdown({ ...query, portfolio_id: null }),
      );

      expect(result.portfolio_points.some((row) => row.portfolio_id === ARQUIVADA)).toBe(
        false,
      );
    });
  });

  describe('o valor de cada classe', () => {
    it('soma as posições de cada carteira na última data que ela tem até o ponto', async () => {
      const repository = createPerformanceRepository(tx);

      await close(LONGO, '2026-06-30', '1.00', '1.000000000000');
      await close(RESERVA, '2026-06-26', '1.00', '1.000000000000');
      await hold(LONGO, ITUB4, '2026-06-30', '10000.00');
      await hold(RESERVA, ITUB4, '2026-06-26', '2500.00');
      await hold(LONGO, HGLG11, '2026-06-30', '3000.00');

      const result = unwrapSuccess(
        await repository.breakdown({ ...query, portfolio_id: null }),
      );
      const value = (category: string) =>
        result.class_values.find(
          (row) => row.category_id === category && row.label === 'reference',
        )?.value;

      // A Reserva ficou para trás em 26/06 e entra com o que tem.
      expect(value(ACOES)).toBe('12500.00');
      expect(value(FIIS)).toBe('3000.00');
    });

    it('o escopo de carteira não enxerga a outra', async () => {
      const repository = createPerformanceRepository(tx);

      await close(LONGO, '2026-06-30', '1.00', '1.000000000000');
      await close(RESERVA, '2026-06-30', '1.00', '1.000000000000');
      await hold(LONGO, ITUB4, '2026-06-30', '10000.00');
      await hold(RESERVA, ITUB4, '2026-06-30', '2500.00');

      const result = unwrapSuccess(await repository.breakdown(query));

      expect(
        result.class_values.find(
          (row) => row.category_id === ACOES && row.label === 'reference',
        )?.value,
      ).toBe('10000.00');
    });

    it('marca o caixa, que não rende por si', async () => {
      const repository = createPerformanceRepository(tx);

      await close(LONGO, '2026-06-30', '1.00', '1.000000000000');
      await hold(LONGO, CAIXA, '2026-06-30', '500.00');
      await hold(LONGO, ITUB4, '2026-06-30', '10000.00');

      const result = unwrapSuccess(await repository.breakdown(query));

      expect(
        result.categories.map((row) => [row.name, row.color_token, row.is_cash]),
      ).toEqual(
        expect.arrayContaining([
          ['Caixa', 'class.caixa', true],
          ['Ações', 'class.acoes', false],
        ]),
      );
    });
  });

  describe('o fluxo e o provento de cada classe', () => {
    const flows = async (overrides: Partial<typeof query> = {}) => {
      const result = unwrapSuccess(
        await createPerformanceRepository(tx).breakdown({ ...query, ...overrides }),
      );

      return result.class_flows.filter((row) => row.category_id === ACOES);
    };

    it('compra é fluxo positivo e venda é negativo, contra o sinal do caixa', async () => {
      await record({
        id: 1,
        kind: 'buy',
        date: '2026-04-10',
        asset: ITUB4,
        net: '-1000.00',
      });
      await record({
        id: 2,
        kind: 'sell',
        date: '2026-04-20',
        asset: ITUB4,
        net: '400.00',
      });

      expect(await flows()).toEqual([
        { category_id: ACOES, trade_date: '2026-04-10', flow: '1000.00', income: '0.00' },
        { category_id: ACOES, trade_date: '2026-04-20', flow: '-400.00', income: '0.00' },
      ]);
    });

    it('a perna de uma transferência entra com o próprio sinal', async () => {
      await record({
        id: 3,
        kind: 'transfer',
        date: '2026-05-05',
        asset: ITUB4,
        net: '800.00',
      });
      await record({
        id: 4,
        kind: 'transfer',
        date: '2026-05-06',
        asset: ITUB4,
        net: '-300.00',
      });

      expect((await flows()).map((row) => row.flow)).toEqual(['800.00', '-300.00']);
    });

    it('provento é rendimento da classe, e não fluxo', async () => {
      await record({
        id: 5,
        kind: 'payout',
        date: '2026-05-15',
        asset: ITUB4,
        net: '120.00',
        payoutKind: 'dividend',
      });

      expect(await flows()).toEqual([
        { category_id: ACOES, trade_date: '2026-05-15', flow: '0.00', income: '120.00' },
      ]);
    });

    it('amortização devolve principal: sai como fluxo, não como rendimento', async () => {
      await record({
        id: 6,
        kind: 'payout',
        date: '2026-05-15',
        asset: ITUB4,
        net: '200.00',
        payoutKind: 'amortization',
      });

      expect(await flows()).toEqual([
        { category_id: ACOES, trade_date: '2026-05-15', flow: '-200.00', income: '0.00' },
      ]);
    });

    it('provento ainda a receber não entrou em caixa e não conta', async () => {
      await record({
        id: 7,
        kind: 'payout',
        date: '2026-05-15',
        asset: ITUB4,
        net: '120.00',
        payoutKind: 'dividend',
        confirmed: false,
      });

      expect(await flows()).toEqual([]);
    });

    it('o caixa não tem fluxo de classe: aporte e resgate não são compra', async () => {
      await record({
        id: 8,
        kind: 'deposit',
        date: '2026-04-10',
        asset: CAIXA,
        net: '5000.00',
      });

      const result = unwrapSuccess(
        await createPerformanceRepository(tx).breakdown(query),
      );

      expect(result.class_flows).toEqual([]);
    });

    it('o dia da base fica de fora e a referência entra', async () => {
      await record({
        id: 9,
        kind: 'buy',
        date: '2026-03-31',
        asset: ITUB4,
        net: '-100.00',
      });
      await record({
        id: 10,
        kind: 'buy',
        date: '2026-06-30',
        asset: ITUB4,
        net: '-200.00',
      });
      await record({
        id: 11,
        kind: 'buy',
        date: '2026-07-01',
        asset: ITUB4,
        net: '-300.00',
      });

      expect((await flows()).map((row) => row.trade_date)).toEqual(['2026-06-30']);
    });

    it('soma o que cai no mesmo dia', async () => {
      await record({
        id: 12,
        kind: 'buy',
        date: '2026-04-10',
        asset: ITUB4,
        net: '-1000.00',
      });
      await record({
        id: 13,
        kind: 'buy',
        date: '2026-04-10',
        asset: ITUB4,
        net: '-500.00',
      });

      expect((await flows()).map((row) => row.flow)).toEqual(['1500.00']);
    });

    it('só as carteiras do escopo', async () => {
      await record({
        id: 14,
        kind: 'buy',
        date: '2026-04-10',
        portfolio: RESERVA,
        asset: ITUB4,
        net: '-1000.00',
      });

      expect(await flows()).toEqual([]);
      expect(await flows({ portfolio_id: null })).toHaveLength(1);
    });
  });
});
