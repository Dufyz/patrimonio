import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

let harness: ApiHarness;
let carteira: string;
let corretora: string;

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);

  const criada = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Longo prazo' });
  carteira = criada.body.portfolio.id;
  corretora = await seedInstitution(harness.sql, 'Corretora A');
});

const compra = (chave?: string) => {
  const pedido = request(harness.app).post('/api/transactions');
  if (chave !== undefined) pedido.set('Idempotency-Key', chave);

  return pedido.send({
    kind: 'buy',
    portfolio_id: carteira,
    institution_id: corretora,
    asset: { ticker: 'ITUB4', name: 'Itaú Unibanco PN', b3_type: 'stock' },
    trade_date: '2026-10-06',
    quantity: '100',
    unit_price: '36.84',
    fees: '0',
  });
};

describe('Idempotency-Key', () => {
  it('a mesma chave duas vezes cria um lançamento só', async () => {
    const primeira = await compra('clique-duplo');
    const segunda = await compra('clique-duplo');

    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(200);
    expect(segunda.body.transaction.id).toBe(primeira.body.transaction.id);

    const extrato = await request(harness.app).get('/api/transactions');
    expect(extrato.body.total).toBe(1);
  });

  it('o replay não enfileira outro recálculo', async () => {
    await compra('clique-duplo');
    const segunda = await compra('clique-duplo');

    expect(segunda.body.recalculation).toBeNull();
  });

  it('o replay não inventa preview: ele descrevia o estado daquele momento', async () => {
    await compra('clique-duplo');
    const segunda = await compra('clique-duplo');

    expect(segunda.body.preview).toBeNull();
  });

  it('chaves diferentes criam lançamentos diferentes', async () => {
    await compra('primeira');
    await compra('segunda');

    const extrato = await request(harness.app).get('/api/transactions');
    expect(extrato.body.total).toBe(2);
  });

  it('sem chave, dois pedidos iguais criam dois lançamentos', async () => {
    await compra();
    await compra();

    const extrato = await request(harness.app).get('/api/transactions');
    expect(extrato.body.total).toBe(2);
  });

  it('a chave expira em 24 horas e volta a valer para um lançamento novo', async () => {
    const primeira = await compra('chave-de-ontem');

    await harness.sql`
      update transaction set created_at = now() - interval '25 hours'
       where id = ${primeira.body.transaction.id}
    `;

    const segunda = await compra('chave-de-ontem');

    expect(segunda.status).toBe(201);
    expect(segunda.body.transaction.id).not.toBe(primeira.body.transaction.id);

    const extrato = await request(harness.app).get('/api/transactions');
    expect(extrato.body.total).toBe(2);
  });

  it('o aporte também respeita a chave', async () => {
    const corpo = {
      kind: 'deposit',
      portfolio_id: carteira,
      institution_id: corretora,
      trade_date: '2026-10-06',
      amount: '5000.00',
    };

    const primeira = await request(harness.app)
      .post('/api/transactions/cash')
      .set('Idempotency-Key', 'aporte-unico')
      .send(corpo);
    const segunda = await request(harness.app)
      .post('/api/transactions/cash')
      .set('Idempotency-Key', 'aporte-unico')
      .send(corpo);

    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(200);

    const extrato = await request(harness.app).get('/api/transactions?kind=deposit');
    expect(extrato.body.total).toBe(1);
  });
});
