import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

let harness: ApiHarness;
let longoPrazo: string;
let corretora: string;

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);

  const primeira = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Longo prazo' });

  longoPrazo = primeira.body.portfolio.id;
  corretora = await seedInstitution(harness.sql, 'Corretora A');
});

const movimentar = (body: Record<string, unknown>) =>
  request(harness.app)
    .post('/api/transactions/cash')
    .send({
      kind: 'deposit',
      portfolio_id: longoPrazo,
      institution_id: corretora,
      trade_date: '2026-10-06',
      amount: '5000.00',
      ...body,
    });

describe('aporte', () => {
  it('cria o caixa como ativo sintético da instituição, na primeira vez', async () => {
    const response = await movimentar({});

    expect(response.status).toBe(201);

    const ativos = await request(harness.app).get(
      '/api/assets?search=CAIXA&include_archived=true',
    );
    expect(ativos.body.assets).toHaveLength(1);
    expect(ativos.body.assets[0].b3_type).toBe('cash');
    expect(ativos.body.assets[0].ticker).toBe('CAIXA-CORRETORAA');
  });

  it('o aporte é um lançamento como os outros, e aparece no extrato', async () => {
    await movimentar({});

    const extrato = await request(harness.app).get('/api/transactions?kind=deposit');

    expect(extrato.body.total).toBe(1);
    expect(extrato.body.data[0].net_amount).toBe('5000.00');
    expect(extrato.body.data[0].asset_id).not.toBeNull();
  });

  it('o preview mostra o saldo de caixa da instituição antes e depois', async () => {
    await movimentar({});

    const segundo = await movimentar({ amount: '1500.00' });

    expect(segundo.body.preview.cash.before).toBe('5000.00');
    expect(segundo.body.preview.cash.after).toBe('6500.00');
  });

  it('o resgate sai do caixa', async () => {
    await movimentar({});

    const resgate = await movimentar({ kind: 'withdrawal', amount: '2000.00' });

    expect(resgate.body.transactions[0].net_amount).toBe('-2000.00');
    expect(resgate.body.preview.cash.after).toBe('3000.00');
  });

  it('a compra consome o caixa da instituição', async () => {
    await movimentar({});

    const compra = await request(harness.app)
      .post('/api/transactions')
      .send({
        kind: 'buy',
        portfolio_id: longoPrazo,
        institution_id: corretora,
        asset: { ticker: 'ITUB4', name: 'Itaú Unibanco PN', b3_type: 'stock' },
        trade_date: '2026-10-06',
        quantity: '100',
        unit_price: '36.84',
        fees: '0',
      });

    expect(compra.body.preview.cash.before).toBe('5000.00');
    expect(compra.body.preview.cash.after).toBe('1316.00');
  });

  it('o aporte enfileira o recálculo da carteira', async () => {
    const response = await movimentar({});

    expect(response.body.recalculation[0].dedupe_key).toBe(`recalc:${longoPrazo}`);
  });
});
