import { statementResourceSchema } from '@patrimonio/contracts';
import type { StatementResource } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * T-04 · A rota que Movimentações consome.
 *
 * A profundidade do SQL está no teste do repositório, em `packages/db`. O que
 * esta suíte prova é o que só o caminho inteiro mostra: que o efeito de cada
 * lançamento sai do motor refeito sobre o livro **gravado pelas rotas de
 * escrita** — e não sobre linhas semeadas à mão —, que a resposta cabe no
 * contrato e que o recorte da query chega inteiro até o repositório.
 */

let harness: ApiHarness;
let carteira: string;
let reserva: string;
let corretora: string;
let wege3: string;
let vale3: string;

const lancar = async (body: Record<string, unknown>) => {
  const response = await request(harness.app).post('/api/transactions').send(body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.transaction as { id: string; asset_id: string };
};

const compra = (
  ticker: string,
  trade_date: string,
  quantity: string,
  unit_price: string,
  portfolio = carteira,
) => ({
  kind: 'buy',
  portfolio_id: portfolio,
  institution_id: corretora,
  asset: { ticker, name: `${ticker} teste`, b3_type: 'stock' },
  trade_date,
  quantity,
  unit_price,
  fees: '0',
});

const extrato = async (query = ''): Promise<StatementResource> => {
  const response = await request(harness.app).get(`/api/statement?${query}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return statementResourceSchema.parse(response.body);
};

const efeitoDe = (resource: StatementResource, id: string) =>
  resource.rows.find((row) => row.id === id)?.effect;

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);

  carteira = (
    await request(harness.app).post('/api/portfolios').send({ name: 'Longo prazo' })
  ).body.portfolio.id;
  reserva = (await request(harness.app).post('/api/portfolios').send({ name: 'Reserva' }))
    .body.portfolio.id;
  corretora = await seedInstitution(harness.sql, 'Corretora A');
});

describe('o efeito de cada lançamento', () => {
  it('a primeira compra abre a posição, e a segunda mostra o preço médio de antes e de depois', async () => {
    const primeira = await lancar(compra('WEGE3', '2026-08-10', '100', '40.00'));
    wege3 = primeira.asset_id;
    const segunda = await lancar({
      ...compra('WEGE3', '2026-09-30', '100', '30.00'),
      asset: undefined,
      asset_id: wege3,
    });

    const body = await extrato(`portfolio_id=${carteira}`);

    expect(efeitoDe(body, primeira.id)).toEqual({
      type: 'position_opened',
      avg_price: '40.00000000',
    });
    expect(efeitoDe(body, segunda.id)).toEqual({
      type: 'average_price',
      before: '40.00000000',
      after: '35.00000000',
    });
  });

  it('a venda traz o resultado realizado do motor, e nulo na isenção ainda não calculada', async () => {
    const abertura = await lancar(compra('VALE3', '2026-08-10', '100', '60.00'));
    vale3 = abertura.asset_id;
    const venda = await lancar({
      kind: 'sell',
      portfolio_id: carteira,
      institution_id: corretora,
      asset_id: vale3,
      trade_date: '2026-09-22',
      quantity: '50',
      unit_price: '57.90',
      fees: '0',
    });

    const body = await extrato(`portfolio_id=${carteira}`);

    // 50 × 57,90 = 2.895,00 contra 50 × 60,00 = 3.000,00 de custo.
    expect(efeitoDe(body, venda.id)).toEqual({
      type: 'realized',
      result: '-105.00',
      exempt: null,
    });
  });

  it('aporte e resgate são dinheiro de fora, e o resumo os separa', async () => {
    await request(harness.app)
      .post('/api/transactions/cash')
      .send({
        kind: 'deposit',
        portfolio_id: carteira,
        institution_id: corretora,
        trade_date: '2026-10-01',
        amount: '4000.00',
      })
      .expect(201);
    await request(harness.app)
      .post('/api/transactions/cash')
      .send({
        kind: 'withdrawal',
        portfolio_id: carteira,
        institution_id: corretora,
        trade_date: '2026-10-02',
        amount: '500.00',
      })
      .expect(201);

    const body = await extrato(`portfolio_id=${carteira}&group=cash`);

    expect(body.rows.map((row) => row.effect.type)).toEqual(['cash_out', 'cash_in']);
    expect(body.summary.deposits).toBe('4000.00');
    expect(body.summary.withdrawals).toBe('500.00');
    // O caixa tem nome: "Caixa · Corretora A", e não uma linha sem ativo.
    expect(body.rows[0]?.asset_name).toBe('Caixa · Corretora A');
  });

  it('provento de FII é isento, e o a receber fica fora do recebido', async () => {
    const fii = await lancar({
      ...compra('BTLG11', '2026-08-10', '140', '100.00'),
      asset: { ticker: 'BTLG11', name: 'BTG Logístico', b3_type: 'fii' },
    });

    const recebido = await request(harness.app)
      .post('/api/transactions/payouts')
      .send({
        portfolio_id: carteira,
        institution_id: corretora,
        asset_id: fii.asset_id,
        payout_kind: 'income',
        record_date: '2026-09-25',
        payment_date: '2026-10-02',
        amount_per_share: '0.91',
        confirmed: true,
      })
      .expect(201);
    const futuro = await request(harness.app)
      .post('/api/transactions/payouts')
      .send({
        portfolio_id: carteira,
        institution_id: corretora,
        asset_id: fii.asset_id,
        payout_kind: 'income',
        record_date: '2026-12-25',
        payment_date: '2026-12-30',
        amount_per_share: '0.95',
        confirmed: false,
      })
      .expect(201);

    const body = await extrato(`portfolio_id=${carteira}&group=payout`);

    expect(efeitoDe(body, recebido.body.transaction.id)).toEqual({
      type: 'payout_exempt',
    });
    expect(efeitoDe(body, futuro.body.transaction.id)?.type).toBe('payout_receivable');
    // Só o que já caiu na conta: 140 × 0,91.
    expect(body.summary.payouts).toBe('127.40');
  });

  it('a transferência diz o sentido e a carteira do outro lado, nas duas pernas', async () => {
    const abertura = await lancar(compra('PETR4', '2026-08-10', '100', '30.00'));

    await request(harness.app)
      .post('/api/transactions/transfer')
      .send({
        from_portfolio_id: carteira,
        to_portfolio_id: reserva,
        asset_id: abertura.asset_id,
        institution_id: corretora,
        trade_date: '2026-09-15',
        quantity: '40',
      })
      .expect(201);

    const origem = await extrato(`portfolio_id=${carteira}&group=transfer`);
    const destino = await extrato(`portfolio_id=${reserva}&group=transfer`);

    expect(origem.rows[0]?.effect).toEqual({
      type: 'transfer',
      direction: 'out',
      counterpart: 'Reserva',
    });
    expect(destino.rows[0]?.effect).toEqual({
      type: 'transfer',
      direction: 'in',
      counterpart: 'Longo prazo',
    });
  });
});

describe('o recorte', () => {
  it('cabe no contrato e traz o escopo, o resumo e as pastilhas', async () => {
    await lancar(compra('WEGE3', '2026-08-10', '100', '40.00'));

    const body = await extrato(`portfolio_id=${carteira}`);

    expect(body.scope.portfolio_name).toBe('Longo prazo');
    expect(body.scope.entries_total).toBe(1);
    expect(body.scope.first_trade_date).toBe('2026-08-10');
    expect(body.summary.buys).toBe('4000.00');
    expect(body.facets_total).toBe(1);
    expect(body.facets.map((facet) => facet.group)).toEqual([
      'buy',
      'sell',
      'payout',
      'cash',
      'transfer',
      'event',
    ]);
    expect(body.institutions.map((item) => item.name)).toEqual(['Corretora A']);
  });

  it('o período, a busca e a página chegam ao repositório', async () => {
    await lancar(compra('WEGE3', '2026-08-10', '100', '40.00'));
    await lancar(compra('VALE3', '2026-09-10', '10', '60.00'));
    await lancar(compra('VALE3', '2026-10-10', '10', '61.00'));

    const periodo = await extrato('from=2026-09-01&to=2026-09-30');
    expect(periodo.rows).toHaveLength(1);
    expect(periodo.earlier).toEqual({ month: '2026-08', count: 1 });

    const busca = await extrato('search=vale');
    expect(busca.page.total).toBe(2);

    const pagina = await extrato('limit=1&page=3');
    expect(pagina.page).toEqual({ number: 3, limit: 1, total: 3 });
    expect(pagina.rows).toHaveLength(1);
  });

  it('uma página sem ativo não paga a segunda consulta', async () => {
    await request(harness.app)
      .post('/api/transactions/cash')
      .send({
        kind: 'deposit',
        portfolio_id: carteira,
        institution_id: corretora,
        trade_date: '2026-10-01',
        amount: '100.00',
      })
      .expect(201);

    // O caixa tem ativo, mas aporte não precisa de replay: o extrato responde.
    const body = await extrato('group=cash');

    expect(body.rows[0]?.effect.type).toBe('cash_in');
  });

  it('período invertido, tipo desconhecido e identificador ruim são recusados com 400', async () => {
    for (const query of [
      'from=2026-10-01&to=2026-09-01',
      'group=emprestimo',
      'portfolio_id=nao-e-uuid',
      'from=ontem',
      'limit=0',
    ]) {
      const response = await request(harness.app).get(`/api/statement?${query}`);
      expect(response.status, query).toBe(400);
    }
  });

  it('o escopo vazio responde inteiro, e não com 404', async () => {
    const body = await extrato();

    expect(body.rows).toEqual([]);
    expect(body.scope.first_trade_date).toBeNull();
    expect(body.earlier).toBeNull();
    expect(body.summary.count).toBe(0);
  });

  it('a rota está na documentação', async () => {
    const docs = await request(harness.app).get('/api/docs.json');

    expect(docs.body.paths['/api/statement']?.get?.tags).toContain('Lançamentos');
  });
});
