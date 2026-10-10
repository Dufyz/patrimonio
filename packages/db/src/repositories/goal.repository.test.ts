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
import { createGoalRepository } from './goal.repository.js';

const LONGO = '0191e5a0-0000-7000-8000-00000000d001';
const RESERVA = '0191e5a0-0000-7000-8000-00000000d002';
const ANTIGA = '0191e5a0-0000-7000-8000-00000000d003';
const INDEPENDENCIA = '0191e5a0-0000-7000-8000-00000000d101';
const VIAGEM = '0191e5a0-0000-7000-8000-00000000d102';
const PATRIMONIO_TODO = '0191e5a0-0000-7000-8000-00000000d103';
const ENCERRADO = '0191e5a0-0000-7000-8000-00000000d104';
const INEXISTENTE = '0191e5a0-0000-7000-8000-00000000dfff';

const HOJE = '2026-10-09';

let sql: Sql;
let tx: TestTransaction;

/**
 * A consulta dos objetivos é uma só, de propósito — o banco fica em outra rede,
 * e cada leitura a mais aparece na abertura da tela. Contar as chamadas é a
 * única forma de essa decisão não se desfazer sozinha no primeiro "só mais um
 * select".
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
  netFlow = '0.00',
): Promise<void> => {
  await tx`
    insert into portfolio_daily (
      portfolio_id, position_date, total_value, net_flow, income, payouts,
      quota_value, quota_count, cumulative_contributions
    )
    values (
      ${portfolio}, ${date}, ${total}, ${netFlow}, '0.00', '0.00',
      '1.000000000000', ${total}, '0.00'
    )
  `;
};

const goal = async (
  id: string,
  name: string,
  options: {
    readonly target?: string;
    readonly date?: string;
    readonly assumption?: string | null;
    readonly today?: boolean;
    readonly createdAt?: string;
    readonly closed?: boolean;
  } = {},
): Promise<void> => {
  await tx`
    insert into goal (
      id, name, target_amount, target_date, return_assumption,
      amount_in_today_brl, created_at, closed_at
    )
    values (
      ${id}, ${name}, ${options.target ?? '1500000.00'}, ${options.date ?? '2040-01-01'},
      ${options.assumption === undefined ? 'IPCA+6' : options.assumption},
      ${options.today ?? true}, ${options.createdAt ?? '2025-10-09T12:00:00Z'},
      ${options.closed === true ? '2026-01-01T00:00:00Z' : null}
    )
  `;
};

const link = async (goalId: string, portfolio: string): Promise<void> => {
  await tx`insert into goal_portfolio (goal_id, portfolio_id) values (${goalId}, ${portfolio})`;
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
    insert into portfolio (id, name, sort_order)
    values (${LONGO}, 'Longo prazo', 1), (${RESERVA}, 'Reserva', 2)
  `;
  await tx`
    insert into portfolio (id, name, sort_order, archived_at)
    values (${ANTIGA}, 'Antiga', 3, '2026-01-01T00:00:00Z')
  `;
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

describe('o instantâneo da tela de objetivos', () => {
  it('lê a tela inteira numa consulta só', async () => {
    const counter = counting(tx);
    const repository = createGoalRepository(counter.connection);

    await goal(INDEPENDENCIA, 'Independência financeira');
    await link(INDEPENDENCIA, LONGO);
    await close(LONGO, '2026-10-08', '300000.00');

    unwrapSuccess(await repository.snapshot({ portfolio_id: null, on_date: HOJE }));

    expect(counter.calls()).toBe(1);
  });

  it('sem objetivo nenhum a lista é vazia, e não um erro', async () => {
    const snapshot = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    );

    expect(snapshot.goals).toEqual([]);
    expect(snapshot.scope_portfolio).toBeNull();
  });

  it('o objetivo mede só as carteiras ligadas a ele, no último fechamento de cada uma', async () => {
    await goal(INDEPENDENCIA, 'Independência financeira');
    await link(INDEPENDENCIA, LONGO);
    await close(LONGO, '2026-10-07', '310000.00');
    await close(LONGO, '2026-10-08', '318904.12');
    await close(RESERVA, '2026-10-08', '62400.00');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row?.linked).toBe(true);
    expect(row?.current_value).toBe('318904.12');
    expect(row?.as_of).toBe('2026-10-08');
    expect(row?.portfolios).toEqual([
      { portfolio_id: LONGO, name: 'Longo prazo', value: '318904.12' },
    ]);
  });

  it('um fechamento depois da data pedida não conta', async () => {
    await goal(INDEPENDENCIA, 'Independência financeira');
    await link(INDEPENDENCIA, LONGO);
    await close(LONGO, '2026-10-08', '300000.00');
    await close(LONGO, '2026-10-20', '999999.00');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row?.current_value).toBe('300000.00');
  });

  it('sem carteira ligada o objetivo mede o patrimônio todo, sem as carteiras arquivadas', async () => {
    await goal(PATRIMONIO_TODO, 'Patrimônio de 1 milhão', { target: '1000000.00' });
    await close(LONGO, '2026-10-08', '300000.00');
    await close(RESERVA, '2026-10-08', '62400.50');
    await close(ANTIGA, '2026-10-08', '5000.00');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row?.linked).toBe(false);
    expect(row?.current_value).toBe('362400.50');
    expect(row?.portfolios.map((portfolio) => portfolio.name)).toEqual([
      'Longo prazo',
      'Reserva',
    ]);
  });

  it('uma carteira atrasada entra com o valor que tem, e não some do total', async () => {
    await goal(PATRIMONIO_TODO, 'Patrimônio de 1 milhão');
    await close(LONGO, '2026-10-08', '300000.00');
    await close(RESERVA, '2026-09-15', '60000.00');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row?.current_value).toBe('360000.00');
    expect(row?.as_of).toBe('2026-10-08');
  });

  it('carteira que ainda não fechou aparece sem valor, e não com zero', async () => {
    await goal(PATRIMONIO_TODO, 'Patrimônio de 1 milhão');
    await close(LONGO, '2026-10-08', '300000.00');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(
      row?.portfolios.find((portfolio) => portfolio.portfolio_id === RESERVA),
    ).toEqual({
      portfolio_id: RESERVA,
      name: 'Reserva',
      value: null,
    });
  });

  it('objetivo sem história não tem começo nem valor, mas existe', async () => {
    await goal(VIAGEM, 'Carro novo', { target: '80000.00' });
    await link(VIAGEM, RESERVA);

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row).toMatchObject({
      current_value: '0',
      as_of: null,
      history_start: null,
      start_date: null,
      start_value: null,
      flows: [],
    });
  });

  it('objetivo encerrado não aparece', async () => {
    await goal(ENCERRADO, 'Reserva de emergência', { closed: true });
    await goal(INDEPENDENCIA, 'Independência financeira');

    const { goals } = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    );

    expect(goals.map((row) => row.goal_id)).toEqual([INDEPENDENCIA]);
  });

  it('vem do prazo mais próximo ao mais distante, e por nome no empate', async () => {
    await goal(INDEPENDENCIA, 'Independência', { date: '2040-01-01' });
    await goal(VIAGEM, 'Viagem', { date: '2027-06-01' });
    await goal(PATRIMONIO_TODO, 'Casa', { date: '2027-06-01' });

    const { goals } = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    );

    expect(goals.map((row) => row.name)).toEqual(['Casa', 'Viagem', 'Independência']);
  });
});

describe('o filtro de carteira', () => {
  beforeEach(async () => {
    await goal(INDEPENDENCIA, 'Independência financeira');
    await link(INDEPENDENCIA, LONGO);
    await goal(VIAGEM, 'Viagem', { date: '2027-06-01' });
    await link(VIAGEM, RESERVA);
    await goal(PATRIMONIO_TODO, 'Patrimônio de 1 milhão', { date: '2035-01-01' });

    await close(LONGO, '2026-10-08', '300000.00');
    await close(RESERVA, '2026-10-08', '60000.00');
  });

  it('escolhe os objetivos que contam a carteira, incluindo os do patrimônio todo', async () => {
    const snapshot = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: RESERVA, on_date: HOJE }),
    );

    expect(snapshot.goals.map((row) => row.name)).toEqual([
      'Viagem',
      'Patrimônio de 1 milhão',
    ]);
    expect(snapshot.scope_portfolio).toEqual({
      portfolio_id: RESERVA,
      name: 'Reserva',
    });
  });

  it('não muda o que cada objetivo mede: o valor é o das carteiras dele', async () => {
    const snapshot = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: LONGO, on_date: HOJE }),
    );

    const todo = snapshot.goals.find((row) => row.goal_id === PATRIMONIO_TODO);

    // O filtro é o Longo prazo, mas o objetivo do patrimônio todo continua
    // medindo as duas carteiras.
    expect(todo?.current_value).toBe('360000.00');
  });

  it('carteira que não existe não devolve a escolha dela, para o caso de uso recusar', async () => {
    const snapshot = unwrapSuccess(
      await createGoalRepository(tx).snapshot({
        portfolio_id: INEXISTENTE,
        on_date: HOJE,
      }),
    );

    expect(snapshot.scope_portfolio).toBeNull();
    expect(snapshot.goals).toEqual([]);
  });

  it('carteira arquivada também não é escopo', async () => {
    const snapshot = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: ANTIGA, on_date: HOJE }),
    );

    expect(snapshot.scope_portfolio).toBeNull();
  });
});

describe('de onde o objetivo parte', () => {
  it('é o dia em que ele foi criado, com o valor que as carteiras tinham então', async () => {
    await goal(INDEPENDENCIA, 'Independência financeira', {
      createdAt: '2026-03-10T12:00:00Z',
    });
    await link(INDEPENDENCIA, LONGO);
    await close(LONGO, '2026-03-09', '200000.00');
    await close(LONGO, '2026-03-12', '210000.00');
    await close(LONGO, '2026-10-08', '318904.12');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row).toMatchObject({
      created_on: '2026-03-10',
      history_start: '2026-03-09',
      start_date: '2026-03-10',
      // O último fechamento até a criação, e não o seguinte.
      start_value: '200000.00',
    });
  });

  it('com a história começando depois da criação, parte do primeiro fechamento', async () => {
    await goal(INDEPENDENCIA, 'Independência financeira', {
      createdAt: '2025-01-10T12:00:00Z',
    });
    await link(INDEPENDENCIA, LONGO);
    await close(LONGO, '2026-03-02', '150000.00');
    await close(LONGO, '2026-10-08', '318904.12');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row).toMatchObject({
      history_start: '2026-03-02',
      start_date: '2026-03-02',
      start_value: '150000.00',
    });
  });

  it('as carteiras que ainda não existiam no começo entram com zero', async () => {
    await goal(PATRIMONIO_TODO, 'Patrimônio de 1 milhão', {
      createdAt: '2026-03-10T12:00:00Z',
    });
    await close(LONGO, '2026-03-09', '200000.00');
    await close(RESERVA, '2026-08-03', '50000.00');
    await close(LONGO, '2026-10-08', '300000.00');
    await close(RESERVA, '2026-10-08', '55000.00');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row?.start_value).toBe('200000.00');
    expect(row?.current_value).toBe('355000.00');
  });
});

describe('o fluxo mensal', () => {
  it('soma o fluxo de cada mês das carteiras do objetivo e omite o mês sem fluxo', async () => {
    await goal(PATRIMONIO_TODO, 'Patrimônio de 1 milhão');
    await close(LONGO, '2026-07-01', '100000.00', '1000.00');
    await close(LONGO, '2026-07-15', '101000.00', '500.00');
    await close(RESERVA, '2026-07-20', '20000.00', '300.00');
    // Agosto sem aporte: não aparece, e o caso de uso o conta como zero.
    await close(LONGO, '2026-08-14', '101500.00');
    await close(LONGO, '2026-09-10', '103500.00', '2000.00');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row?.flows).toEqual([
      { month: '2026-07', net_flow: '1800.00' },
      { month: '2026-09', net_flow: '2000.00' },
    ]);
  });

  it('resgate é fluxo negativo e abate o mês', async () => {
    await goal(PATRIMONIO_TODO, 'Patrimônio de 1 milhão');
    await close(LONGO, '2026-07-01', '100000.00', '1000.00');
    await close(LONGO, '2026-07-20', '99000.00', '-400.00');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row?.flows).toEqual([{ month: '2026-07', net_flow: '600.00' }]);
  });

  it('só os últimos doze meses, mais o corrente', async () => {
    await goal(PATRIMONIO_TODO, 'Patrimônio de 1 milhão');
    await close(LONGO, '2025-09-15', '100000.00', '7777.00');
    await close(LONGO, '2025-10-15', '100000.00', '100.00');
    await close(LONGO, '2026-10-05', '110000.00', '200.00');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row?.flows).toEqual([
      { month: '2025-10', net_flow: '100.00' },
      { month: '2026-10', net_flow: '200.00' },
    ]);
  });

  it('fluxo de carteira que o objetivo não mede não entra', async () => {
    await goal(INDEPENDENCIA, 'Independência financeira');
    await link(INDEPENDENCIA, LONGO);
    await close(LONGO, '2026-07-01', '100000.00', '1000.00');
    await close(RESERVA, '2026-07-01', '20000.00', '9999.00');

    const [row] = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    ).goals;

    expect(row?.flows).toEqual([{ month: '2026-07', net_flow: '1000.00' }]);
  });
});

describe('a inflação dos últimos doze meses', () => {
  const quote = async (date: string, factor: string): Promise<void> => {
    await tx`
      insert into index_quote (index_code, quote_date, daily_factor, raw_value, source)
      values ('IPCA', ${date}, ${factor}, '0', 'teste')
    `;
  };

  it('é o produto dos fatores diários do IPCA, e não a soma', async () => {
    await quote('2026-03-02', '1.010000000000');
    await quote('2026-04-01', '1.020000000000');

    const { inflation } = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    );

    expect(Number(inflation.factor)).toBeCloseTo(1.0302, 10);
    expect(inflation.first_date).toBe('2026-03-02');
    expect(inflation.last_date).toBe('2026-04-01');
  });

  it('fator de mais de doze meses atrás não entra', async () => {
    await quote('2025-08-01', '1.500000000000');
    await quote('2026-04-01', '1.020000000000');

    const { inflation } = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    );

    expect(Number(inflation.factor)).toBeCloseTo(1.02, 10);
  });

  it('sem nenhum fator, a inflação é ausente, e não zero', async () => {
    const { inflation } = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    );

    expect(inflation).toEqual({ factor: null, first_date: null, last_date: null });
  });

  it('outro índice não é IPCA', async () => {
    await tx`
      insert into index_quote (index_code, quote_date, daily_factor, raw_value, source)
      values ('CDI', '2026-04-01', '1.000500000000', '0', 'teste')
    `;

    const { inflation } = unwrapSuccess(
      await createGoalRepository(tx).snapshot({ portfolio_id: null, on_date: HOJE }),
    );

    expect(inflation.factor).toBeNull();
  });
});
