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
import { createSearchRepository } from './search.repository.js';

/**
 * T-09 · A busca global.
 *
 uma ordem que desempata pelo alfabeto põe em primeiro o papel que
 * a pessoa nem tem.
 *
 * O cenário é o da prancha 12: ITUB4 em carteira, ITUB3 só cadastrado.
 */

const LONGO = '0191e5a0-0000-7000-8000-0000000f0001';
const RESERVA = '0191e5a0-0000-7000-8000-0000000f0002';
const ARQUIVADA = '0191e5a0-0000-7000-8000-0000000f0003';
const CORRETORA = '0191e5a0-0000-7000-8000-0000000f0011';
const ITUB4 = '0191e5a0-0000-7000-8000-0000000f0031';
const ITUB3 = '0191e5a0-0000-7000-8000-0000000f0032';
const WEGE3 = '0191e5a0-0000-7000-8000-0000000f0033';
const VALE3 = '0191e5a0-0000-7000-8000-0000000f0034';
const ITAUSA = '0191e5a0-0000-7000-8000-0000000f0035';
const ANTIGO = '0191e5a0-0000-7000-8000-0000000f0036';

const id = (n: number): string =>
  `0191e5a0-0000-7000-8000-0000000e${String(n).padStart(4, '0')}`;

let sql: Sql;
let tx: TestTransaction;

type Filter = Parameters<ReturnType<typeof createSearchRepository>['find']>[0];

const filter = (overrides: Partial<Filter> = {}): Filter => ({
  text: 'itu',
  portfolioId: LONGO,
  limit: 5,
  ...overrides,
});

const find = async (overrides: Partial<Filter> = {}) =>
  unwrapSuccess(await createSearchRepository(tx).find(filter(overrides)));

/** Conta quantas consultas a rota paga: é o que o orçamento de T-11 vigia. */
const counting = (): {
  readonly connection: Connection;
  readonly count: () => number;
} => {
  let queries = 0;
  const wrapped = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries += 1;
    return (tx as unknown as (s: TemplateStringsArray, ...v: unknown[]) => unknown)(
      strings,
      ...values,
    );
  }) as unknown as Connection;
  return { connection: wrapped, count: () => queries };
};

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

beforeEach(async () => {
  tx = await beginTestTransaction(sql);

  await tx`
    INSERT INTO portfolio (id, name, sort_order, archived_at) VALUES
      (${LONGO}, 'Longo prazo', 1, NULL),
      (${RESERVA}, 'Reserva', 2, NULL),
      (${ARQUIVADA}, 'Antiga', 3, NOW())
  `;
  await tx`
    INSERT INTO institution (id, name, role)
    VALUES (${CORRETORA}, 'Corretora A', 'custodian')
  `;
  await tx`
    INSERT INTO asset (id, ticker, name, origin, b3_type, archived_at) VALUES
      (${ITUB4}, 'ITUB4', 'Itaú Unibanco PN', 'market', 'stock', NULL),
      (${ITUB3}, 'ITUB3', 'Itaú Unibanco ON', 'market', 'stock', NULL),
      (${WEGE3}, 'WEGE3', 'WEG ON', 'market', 'stock', NULL),
      (${VALE3}, 'VALE3', 'Vale ON', 'market', 'stock', NULL),
      (${ITAUSA}, 'ITSA4', 'Itaúsa PN', 'market', 'stock', NULL),
      (${ANTIGO}, 'ITUB9', 'Itaú Antigo', 'market', 'stock', NOW())
  `;

  // ITUB4: 500 na Longo prazo e 100 na Reserva, e um dia antigo com outra
  // quantidade — só o último dia de cada carteira conta.
  await tx`
    INSERT INTO position_daily
      (portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
       market_value, price_source_kind)
    VALUES
      (${LONGO}, ${ITUB4}, '2026-10-07', '300', '30.00', '9000.00', '10000.00', 'fresh'),
      (${LONGO}, ${ITUB4}, '2026-10-08', '500', '30.00', '15000.00', '18420.00', 'fresh'),
      (${RESERVA}, ${ITUB4}, '2026-10-08', '100', '31.00', '3100.00', '3684.00', 'fresh'),
      (${LONGO}, ${WEGE3}, '2026-10-08', '100', '31.20', '3120.00', '3500.00', 'fresh'),
      (${LONGO}, ${VALE3}, '2026-10-08', '0', '0', '0.00', '0.00', 'fresh'),
      (${ARQUIVADA}, ${ITUB3}, '2026-10-08', '999', '1.00', '999.00', '999.00', 'fresh')
  `;

  await tx`
    INSERT INTO transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
       institution_id, quantity, unit_price, fees, gross_amount, net_amount,
       payout_kind, confirmed_at, note)
    VALUES
      (${id(1)}, 'buy', '2025-03-12', '2025-03-14', ${LONGO}, ${ITUB4},
       ${CORRETORA}, '100', '30.00', '0', '3000.00', '-3000.00', NULL, NULL, NULL),
      (${id(2)}, 'payout', '2026-10-20', '2026-10-20', ${LONGO}, ${ITUB4},
       ${CORRETORA}, '500', '0.19', '0', '96.12', '96.12', 'jcp', NULL, NULL),
      (${id(3)}, 'buy', '2026-09-30', '2026-10-02', ${LONGO}, ${WEGE3},
       ${CORRETORA}, '100', '31.20', '0', '3120.00', '-3120.00', NULL, NULL,
       'comprei pela dica do itu'),
      (${id(4)}, 'buy', '2026-09-10', '2026-09-12', ${RESERVA}, ${ITUB4},
       ${CORRETORA}, '100', '31.00', '0', '3100.00', '-3100.00', NULL, NULL, NULL),
      (${id(5)}, 'buy', '2026-09-11', '2026-09-13', ${ARQUIVADA}, ${ITUB4},
       ${CORRETORA}, '10', '31.00', '0', '310.00', '-310.00', NULL, NULL, NULL),
      (${id(6)}, 'deposit', '2026-10-01', '2026-10-01', ${LONGO}, NULL,
       ${CORRETORA}, '0', '0', '0', '4000.00', '4000.00', NULL, NULL, 'aporte itu')
  `;
});

describe('ativos', () => {
  it('põe primeiro o ativo que a pessoa tem, mesmo empatado no texto', async () => {
    const view = await find();

    // ITUB3 vem antes no alfabeto; ITUB4 vem antes porque tem posição. A Itaúsa
    // não contém "itu", e o ITUB9 está arquivado: nenhum dos dois entra.
    expect(view.assets.rows.map((row) => row.ticker)).toEqual(['ITUB4', 'ITUB3']);
  });

  it('usa o último dia da carteira, e não o dia antigo', async () => {
    const view = await find();
    const itub4 = view.assets.rows[0];

    expect(itub4?.quantity).toBe('500.00000000');
    expect(itub4?.market_value).toBe('18420.00');
    expect(itub4?.portfolio_names).toEqual(['Longo prazo']);
  });

  it('não inventa posição para o ativo que só está cadastrado', async () => {
    const view = await find();
    const itub3 = view.assets.rows.find((row) => row.ticker === 'ITUB3');

    expect(itub3?.quantity).toBeNull();
    expect(itub3?.market_value).toBeNull();
    expect(itub3?.portfolio_names).toEqual([]);
  });

  it('não conta posição de carteira arquivada', async () => {
    const view = await find();

    // A ITUB3 tem 999 na carteira arquivada, e isso não aparece.
    expect(view.assets.rows.find((row) => row.ticker === 'ITUB3')?.quantity).toBeNull();
  });

  it('trata posição zerada como "não tem"', async () => {
    const view = await find({ text: 'vale' });

    expect(view.assets.rows).toHaveLength(1);
    expect(view.assets.rows[0]?.quantity).toBeNull();
  });

  it('restringe a posição à carteira escolhida', async () => {
    const view = await find({ portfolioId: RESERVA });
    const itub4 = view.assets.rows.find((row) => row.ticker === 'ITUB4');

    expect(itub4?.quantity).toBe('100.00000000');
    expect(itub4?.market_value).toBe('3684.00');
    expect(itub4?.portfolio_names).toEqual(['Reserva']);
  });

  it('não devolve ativo arquivado', async () => {
    const view = await find();

    expect(view.assets.rows.map((row) => row.ticker)).not.toContain('ITUB9');
  });

  it('põe o código exato antes de quem só contém o texto', async () => {
    const view = await find({ text: 'vale3' });

    expect(view.assets.rows[0]?.ticker).toBe('VALE3');
  });

  it('casa pelo nome, sem distinguir maiúscula', async () => {
    const view = await find({ text: 'WEG' });

    expect(view.assets.rows.map((row) => row.ticker)).toEqual(['WEGE3']);
  });

  it('ignora acento dos dois lados', async () => {
    // Digitado sem acento, achando "Itaú"; digitado com acento, achando o mesmo.
    // Os três nomes começam com "Itaú": empatam, e a posição desempata antes do alfabeto.
    expect((await find({ text: 'itau' })).assets.rows.map((row) => row.ticker)).toEqual([
      'ITUB4',
      'ITSA4',
      'ITUB3',
    ]);
    expect((await find({ text: 'itaú' })).assets.total).toBe(3);
    expect((await find({ text: 'ITAUSA' })).assets.rows.map((row) => row.ticker)).toEqual(
      ['ITSA4'],
    );
  });

  it('conta o total do banco, não o do que coube', async () => {
    const view = await find({ limit: 1 });

    expect(view.assets.rows).toHaveLength(1);
    expect(view.assets.total).toBe(2);
  });

  it('trata % e _ digitados como texto, não como curinga', async () => {
    expect((await find({ text: '%' })).assets.total).toBe(0);
    expect((await find({ text: 'ITUB_' })).assets.total).toBe(0);
  });

  it('devolve vazio, e não erro, quando nada casa', async () => {
    const view = await find({ text: 'zzzz' });

    expect(view.assets).toEqual({ total: 0, rows: [] });
    expect(view.transactions).toEqual({ total: 0, rows: [] });
  });
});

describe('lançamentos', () => {
  it('traz o mais recente primeiro, por código, nome e observação', async () => {
    const view = await find();

    // Provento de 20/10, depois o aporte de 01/10 (pela observação) e a compra de
    // 30/09 na WEGE3 (pela observação); a de março de 2025 fecha a lista, e as
    // de outras carteiras não entram.
    expect(view.transactions.rows.map((row) => row.id)).toEqual([
      id(2),
      id(6),
      id(3),
      id(1),
    ]);
    expect(view.transactions.total).toBe(4);
  });

  it('diz que o provento ainda está a receber', async () => {
    const view = await find();
    const jcp = view.transactions.rows.find((row) => row.id === id(2));

    expect(jcp?.kind).toBe('payout');
    expect(jcp?.payout_kind).toBe('jcp');
    expect(jcp?.confirmed_at).toBeNull();
    expect(jcp?.net_amount).toBe('96.12');
    expect(jcp?.portfolio_name).toBe('Longo prazo');
    // O nome e o tipo seguem junto, para o título do ativo seguir a regra da tela.
    expect(jcp?.asset_name).toBe('Itaú Unibanco PN');
    expect(jcp?.b3_type).toBe('stock');
  });

  it('entrega lançamento sem ativo, como o aporte', async () => {
    const view = await find();
    const aporte = view.transactions.rows.find((row) => row.id === id(6));

    expect(aporte?.asset_id).toBeNull();
    expect(aporte?.ticker).toBeNull();
  });

  it('restringe à carteira escolhida', async () => {
    const view = await find({ portfolioId: RESERVA });

    expect(view.transactions.rows.map((row) => row.id)).toEqual([id(4)]);
  });

  it('respeita o limite e conta o total', async () => {
    const view = await find({ limit: 2 });

    expect(view.transactions.rows).toHaveLength(2);
    expect(view.transactions.total).toBe(4);
  });
});

describe('orçamento de consultas', () => {
  it('paga exatamente duas consultas por busca', async () => {
    const { connection, count } = counting();

    unwrapSuccess(await createSearchRepository(connection).find(filter()));

    expect(count()).toBe(2);
  });
});
