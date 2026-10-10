import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../postgresql.js';
import type { Sql } from '../postgresql.js';
import {
  beginTestTransaction,
  createTestConnection,
  prepareTestDatabase,
  rollbackTestTransaction,
} from '../testing/database.js';
import type { TestTransaction } from '../testing/database.js';
import { createStatementRepository } from './statement.repository.js';

/**
 * T-04 · O extrato do livro.
 *
 * Contra Postgres real, pela razão de sempre: é a consulta que erra. Um `join`
 * que duplica linha faz o provento do mês aparecer dobrado, e um subtotal
 * somado sobre a página, e não sobre o mês, passa em qualquer mock.
 *
 * Os números são os da prancha 07, de propósito: dez lançamentos em
 * setembro e outubro de 2026, com aportes de 11.400,00, compras de 5.721,00,
 * vendas de 2.895,00 e proventos de 553,55.
 */

const CARTEIRA = '0191e5a0-0000-7000-8000-0000000d0001';
const RESERVA = '0191e5a0-0000-7000-8000-0000000d0002';
const ARQUIVADA = '0191e5a0-0000-7000-8000-0000000d0003';
const CORRETORA = '0191e5a0-0000-7000-8000-0000000d0011';
const TESOURO = '0191e5a0-0000-7000-8000-0000000d0012';
const WEGE3 = '0191e5a0-0000-7000-8000-0000000d0031';
const HGLG11 = '0191e5a0-0000-7000-8000-0000000d0032';
const VALE3 = '0191e5a0-0000-7000-8000-0000000d0033';
const BTLG11 = '0191e5a0-0000-7000-8000-0000000d0034';
const KNRI11 = '0191e5a0-0000-7000-8000-0000000d0035';
const PETR4 = '0191e5a0-0000-7000-8000-0000000d0036';
const IPCA45 = '0191e5a0-0000-7000-8000-0000000d0037';
const CAIXA = '0191e5a0-0000-7000-8000-0000000d0038';

const id = (n: number): string =>
  `0191e5a0-0000-7000-8000-0000000e${String(n).padStart(4, '0')}`;

let sql: Sql;
let tx: TestTransaction;

type Filter = Parameters<ReturnType<typeof createStatementRepository>['page']>[0];

const filter = (overrides: Partial<Filter> = {}): Filter => ({
  portfolioId: CARTEIRA,
  institutionId: null,
  group: null,
  search: null,
  from: '2026-09-01',
  to: '2026-10-31',
  page: 1,
  limit: 50,
  ...overrides,
});

const page = async (overrides: Partial<Filter> = {}) =>
  unwrapSuccess(await createStatementRepository(tx).page(filter(overrides)));

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
    INSERT INTO portfolio (id, name, archived_at) VALUES
      (${CARTEIRA}, 'Longo prazo', NULL),
      (${RESERVA}, 'Reserva', NULL),
      (${ARQUIVADA}, 'Antiga', NOW())
  `;
  await tx`
    INSERT INTO institution (id, name, role) VALUES
      (${CORRETORA}, 'Corretora A', 'custodian'),
      (${TESOURO}, 'Tesouro Direto', 'custodian')
  `;
  await tx`
    INSERT INTO asset (id, ticker, name, origin, b3_type) VALUES
      (${WEGE3}, 'WEGE3', 'WEG ON', 'market', 'stock'),
      (${HGLG11}, 'HGLG11', 'CSHG Logística', 'market', 'fii'),
      (${VALE3}, 'VALE3', 'Vale ON', 'market', 'stock'),
      (${BTLG11}, 'BTLG11', 'BTG Logístico', 'market', 'fii'),
      (${KNRI11}, 'KNRI11', 'Kinea Renda', 'market', 'fii'),
      (${PETR4}, 'PETR4', 'Petrobras PN', 'market', 'stock'),
      (${IPCA45}, 'TESOURO-IPCA-2045', 'Tesouro IPCA+ 2045', 'market', 'treasury'),
      (${CAIXA}, 'CAIXA-CORRETORAA', 'Caixa · Corretora A', 'market', 'cash')
  `;

  // Setembro e outubro de 2026, como a prancha 07. As compras e os aportes
  // levam o sinal do caixa: o que sai é negativo.
  await tx`
    INSERT INTO transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
       institution_id, quantity, unit_price, fees, gross_amount, net_amount,
       payout_kind, confirmed_at)
    VALUES
      (${id(1)}, 'payout', '2026-10-02', '2026-10-02', ${CARTEIRA}, ${BTLG11},
       ${CORRETORA}, '140', '0.91', '0', '127.40', '127.40', 'income', NOW()),
      (${id(2)}, 'deposit', '2026-10-01', '2026-10-01', ${CARTEIRA}, ${CAIXA},
       ${CORRETORA}, '0', '0', '0', '4000.00', '4000.00', NULL, NULL),
      (${id(3)}, 'buy', '2026-09-30', '2026-10-02', ${CARTEIRA}, ${WEGE3},
       ${CORRETORA}, '100', '31.20', '0', '3120.00', '-3120.00', NULL, NULL),
      (${id(4)}, 'buy', '2026-09-25', '2026-09-29', ${CARTEIRA}, ${HGLG11},
       ${CORRETORA}, '10', '160.10', '0', '1601.00', '-1601.00', NULL, NULL),
      (${id(5)}, 'sell', '2026-09-22', '2026-09-24', ${CARTEIRA}, ${VALE3},
       ${CORRETORA}, '50', '57.90', '0', '2895.00', '2895.00', NULL, NULL),
      (${id(6)}, 'payout', '2026-09-15', '2026-09-15', ${CARTEIRA}, ${HGLG11},
       ${CORRETORA}, '100', '1.82', '0', '182.40', '182.40', 'income', NOW()),
      (${id(7)}, 'payout', '2026-09-15', '2026-09-15', ${CARTEIRA}, ${KNRI11},
       ${CORRETORA}, '105', '1.35', '0', '141.75', '141.75', 'income', NOW()),
      (${id(8)}, 'buy', '2026-09-12', '2026-09-12', ${CARTEIRA}, ${IPCA45},
       ${TESOURO}, '0.74', '1351.35', '0', '1000.00', '-1000.00', NULL, NULL),
      (${id(9)}, 'deposit', '2026-09-05', '2026-09-05', ${CARTEIRA}, ${CAIXA},
       ${CORRETORA}, '0', '0', '0', '7400.00', '7400.00', NULL, NULL),
      (${id(10)}, 'payout', '2026-09-01', '2026-09-01', ${CARTEIRA}, ${PETR4},
       ${CORRETORA}, '340', '0.30', '0', '102.00', '102.00', 'dividend', NOW())
  `;

  // Antes do período: duas em agosto, uma em março. É o que o "Ampliar o
  // período" aponta, e o que o escopo conta como 312 desde mar/2021.
  await tx`
    INSERT INTO transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
       institution_id, quantity, unit_price, fees, gross_amount, net_amount)
    VALUES
      (${id(11)}, 'buy', '2026-08-20', '2026-08-22', ${CARTEIRA}, ${WEGE3},
       ${CORRETORA}, '100', '45.20', '0', '4520.00', '-4520.00'),
      (${id(12)}, 'buy', '2026-08-04', '2026-08-06', ${CARTEIRA}, ${VALE3},
       ${CORRETORA}, '50', '60.00', '0', '3000.00', '-3000.00'),
      (${id(13)}, 'buy', '2026-03-02', '2026-03-04', ${CARTEIRA}, ${PETR4},
       ${CORRETORA}, '340', '35.00', '0', '11900.00', '-11900.00')
  `;

  // Outra carteira, e uma arquivada: nenhuma das duas entra no extrato da
  // Longo prazo, e a arquivada não entra nem no consolidado.
  await tx`
    INSERT INTO transaction
      (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
       institution_id, quantity, unit_price, fees, gross_amount, net_amount)
    VALUES
      (${id(20)}, 'buy', '2026-09-10', '2026-09-12', ${RESERVA}, ${VALE3},
       ${TESOURO}, '10', '60.00', '0', '600.00', '-600.00'),
      (${id(21)}, 'buy', '2026-09-11', '2026-09-13', ${ARQUIVADA}, ${VALE3},
       ${CORRETORA}, '10', '60.00', '0', '600.00', '-600.00')
  `;

  await tx`
    INSERT INTO realized_result
      (transaction_id, portfolio_id, asset_id, trade_date, proceeds,
       cost_consumed, result, exempt)
    VALUES
      (${id(5)}, ${CARTEIRA}, ${VALE3}, '2026-09-22', '2895.00', '3205.00', '-310.00', TRUE)
  `;
});

describe('resumo, pastilhas e subtotais', () => {
  it('soma o período como a prancha 07', async () => {
    const view = await page();

    expect(view.summary).toEqual({
      count: 10,
      deposits: '11400.00',
      withdrawals: '0.00',
      buys: '5721.00',
      sells: '2895.00',
      payouts: '553.55',
    });
    expect(view.total).toBe(10);
  });

  it('conta cada pastilha, e o "Todos" é a soma delas', async () => {
    const view = await page();
    const counts = Object.fromEntries(view.facets.map((f) => [f.group, f.count]));

    expect(counts).toEqual({
      buy: 3,
      sell: 1,
      payout: 4,
      cash: 2,
      transfer: 0,
      event: 0,
    });
    expect(view.facets_total).toBe(10);
  });

  it('escolher um tipo muda o resumo e a tabela, mas não as pastilhas', async () => {
    const view = await page({ group: 'payout' });
    const counts = Object.fromEntries(view.facets.map((f) => [f.group, f.count]));

    expect(view.total).toBe(4);
    expect(view.rows).toHaveLength(4);
    expect(view.summary.payouts).toBe('553.55');
    expect(view.summary.buys).toBe('0.00');
    // Contar sob o tipo escolhido zeraria as outras pastilhas no primeiro clique.
    expect(counts['buy']).toBe(3);
    expect(view.facets_total).toBe(10);
  });

  it('entrega o subtotal de cada mês, do mais novo para o mais antigo', async () => {
    const view = await page();

    expect(view.months.map((month) => month.month)).toEqual(['2026-10', '2026-09']);
    expect(view.months[0]).toMatchObject({
      count: 2,
      deposits: '4000.00',
      payouts: '127.40',
      buys: '0.00',
    });
    expect(view.months[1]).toMatchObject({
      count: 8,
      deposits: '7400.00',
      buys: '5721.00',
      sells: '2895.00',
      payouts: '426.15',
    });
  });

  it('o subtotal do mês é do mês inteiro, e não da página', async () => {
    const view = await page({ limit: 3, page: 2 });

    expect(view.rows).toHaveLength(3);
    expect(view.total).toBe(10);
    expect(view.months[1]?.count).toBe(8);
    expect(view.months[1]?.buys).toBe('5721.00');
  });

  it('provento a receber aparece na tabela e não entra no recebido', async () => {
    await tx`
      INSERT INTO transaction
        (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
         institution_id, quantity, unit_price, gross_amount, net_amount,
         payout_kind, confirmed_at, expected_net_amount)
      VALUES
        (${id(30)}, 'payout', '2026-10-05', '2026-10-20', ${CARTEIRA}, ${KNRI11},
         ${CORRETORA}, '105', '1.40', '147.00', '147.00', 'income', NULL, '147.00')
    `;

    const view = await page();

    expect(view.total).toBe(11);
    expect(view.summary.payouts).toBe('553.55');
    expect(view.rows.find((row) => row.id === id(30))?.confirmed_at).toBeNull();
    expect(view.rows.find((row) => row.id === id(30))?.expected_net_amount).toBe(
      '147.00',
    );
  });

  it('resgate entra em módulo, e transferência e evento ficam fora dos valores', async () => {
    await tx`
      INSERT INTO transaction
        (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
         institution_id, quantity, unit_price, gross_amount, net_amount)
      VALUES
        (${id(31)}, 'withdrawal', '2026-10-03', '2026-10-03', ${CARTEIRA}, ${CAIXA},
         ${CORRETORA}, '0', '0', '500.00', '-500.00')
    `;

    const view = await page({ group: 'cash' });

    expect(view.summary.withdrawals).toBe('500.00');
    expect(view.summary.deposits).toBe('11400.00');
    expect(view.summary.buys).toBe('0.00');
  });
});

describe('filtros combináveis', () => {
  it('ordena do mais novo para o mais antigo, com desempate pelo id', async () => {
    const view = await page();

    expect(view.rows.map((row) => row.trade_date)).toEqual([
      '2026-10-02',
      '2026-10-01',
      '2026-09-30',
      '2026-09-25',
      '2026-09-22',
      '2026-09-15',
      '2026-09-15',
      '2026-09-12',
      '2026-09-05',
      '2026-09-01',
    ]);
    // As duas de 15/09: id decrescente.
    expect(view.rows[5]?.id).toBe(id(7));
    expect(view.rows[6]?.id).toBe(id(6));
  });

  it('busca pelo código e pelo nome, sem distinguir maiúscula', async () => {
    expect((await page({ search: 'hglg' })).rows.map((row) => row.ticker)).toEqual([
      'HGLG11',
      'HGLG11',
    ]);
    expect((await page({ search: 'petrobras' })).rows.map((row) => row.ticker)).toEqual([
      'PETR4',
    ]);
  });

  it('trata % e _ digitados como texto, e não como curinga', async () => {
    expect((await page({ search: '%' })).rows).toHaveLength(0);
    expect((await page({ search: 'HG_G' })).rows).toHaveLength(0);
  });

  it('filtra por instituição sem encolher a lista de instituições', async () => {
    const view = await page({ institutionId: TESOURO });

    expect(view.rows.map((row) => row.ticker)).toEqual(['TESOURO-IPCA-2045']);
    expect(view.institutions.map((item) => item.name)).toEqual([
      'Corretora A',
      'Tesouro Direto',
    ]);
  });

  it('combina tipo, instituição e busca', async () => {
    const view = await page({ group: 'buy', institutionId: CORRETORA, search: 'wege' });

    expect(view.rows.map((row) => row.id)).toEqual([id(3)]);
    expect(view.summary.buys).toBe('3120.00');
  });

  it('o escopo é a carteira, e carteira arquivada não entra no consolidado', async () => {
    const reserva = await page({ portfolioId: RESERVA });
    expect(reserva.rows.map((row) => row.id)).toEqual([id(20)]);
    expect(reserva.scope.portfolio_name).toBe('Reserva');

    const todas = await page({ portfolioId: null });
    expect(todas.total).toBe(11);
    expect(todas.rows.map((row) => row.id)).not.toContain(id(21));
    expect(todas.scope.portfolio_id).toBeNull();
    expect(todas.scope.portfolio_name).toBeNull();
  });

  it('sem período devolve o livro inteiro', async () => {
    const view = await page({ from: null, to: null });

    expect(view.total).toBe(13);
    expect(view.earlier).toBeNull();
  });
});

describe('escopo e "ampliar o período"', () => {
  it('diz quantos lançamentos o escopo tem e quando começou, sem filtro', async () => {
    const view = await page({ group: 'sell', search: 'xyz' });

    expect(view.scope.entries_total).toBe(13);
    expect(view.scope.first_trade_date).toBe('2026-03-02');
  });

  it('aponta o mês anterior ao início, com a contagem dele', async () => {
    const view = await page();

    expect(view.earlier).toEqual({ month: '2026-08', count: 2 });
  });

  it('respeita os outros filtros ao procurar o que há antes', async () => {
    const view = await page({ group: 'sell' });

    // Não existe venda antes de setembro: o link não pode oferecer agosto.
    expect(view.earlier).toBeNull();
  });

  it('conta só a parte do mês que fica antes do início', async () => {
    const view = await page({ from: '2026-08-10' });

    expect(view.earlier).toEqual({ month: '2026-08', count: 1 });
  });
});

describe('o que o recálculo grava', () => {
  it('traz a isenção da venda, e nulo quando ela ainda não foi recalculada', async () => {
    const view = await page();

    expect(view.rows.find((row) => row.id === id(5))?.realized_exempt).toBe(true);
    expect(view.rows.find((row) => row.id === id(3))?.realized_exempt).toBeNull();
  });

  it('nomeia a carteira do outro lado de uma transferência', async () => {
    const grupo = '0191e5a0-0000-7000-8000-0000000f0001';

    await tx`
      INSERT INTO transaction
        (id, kind, trade_date, settlement_date, portfolio_id, asset_id,
         institution_id, quantity, unit_price, gross_amount, net_amount,
         transfer_group_id)
      VALUES
        (${id(40)}, 'transfer', '2026-10-04', '2026-10-04', ${CARTEIRA}, ${VALE3},
         ${CORRETORA}, '10', '60.00', '600.00', '-600.00', ${grupo}),
        (${id(41)}, 'transfer', '2026-10-04', '2026-10-04', ${RESERVA}, ${VALE3},
         ${CORRETORA}, '10', '60.00', '600.00', '600.00', ${grupo})
    `;

    const view = await page();
    const saida = view.rows.find((row) => row.id === id(40));

    expect(saida?.transfer_counterpart).toBe('Reserva');
    expect(view.rows.find((row) => row.id === id(3))?.transfer_counterpart).toBeNull();
  });

  it('conta as carteiras em recálculo e as que falharam', async () => {
    await tx`UPDATE portfolio SET recalc_status = 'running' WHERE id = ${CARTEIRA}`;
    await tx`UPDATE portfolio SET recalc_status = 'failed' WHERE id = ${RESERVA}`;

    expect((await page()).recalculation).toEqual({ pending: 1, failed: 0 });
    expect((await page({ portfolioId: null })).recalculation).toEqual({
      pending: 1,
      failed: 1,
    });
  });
});

describe('o livro dos ativos da página', () => {
  const history = async (
    pairs: readonly { portfolio_id: string; asset_id: string }[],
    until: string,
  ) => unwrapSuccess(await createStatementRepository(tx).history(pairs, until));

  it('devolve o livro do par, em ordem, até a data pedida', async () => {
    const rows = await history(
      [{ portfolio_id: CARTEIRA, asset_id: WEGE3 }],
      '2026-09-30',
    );

    expect(rows.map((row) => row.id)).toEqual([id(11), id(3)]);
    expect(rows[0]).toMatchObject({
      kind: 'buy',
      quantity: '100.00000000',
      unit_price: '45.20000000',
      net_amount: '-4520.00',
    });
  });

  it('não vaza o livro de outro par nem lançamento posterior à data', async () => {
    const rows = await history(
      [{ portfolio_id: CARTEIRA, asset_id: VALE3 }],
      '2026-08-31',
    );

    // A venda de setembro e a compra da Reserva ficam de fora.
    expect(rows.map((row) => row.id)).toEqual([id(12)]);
  });

  it('não vai ao banco quando a página não tem ativo', async () => {
    expect(await history([], '2026-10-31')).toEqual([]);
  });
});
