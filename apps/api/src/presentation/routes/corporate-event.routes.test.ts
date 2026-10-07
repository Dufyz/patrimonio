import { corporateEventResourceSchema } from '@patrimonio/contracts';
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
let itub4: string;

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

  const compra = await request(harness.app)
    .post('/api/transactions')
    .send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretora,
      asset: { ticker: 'ITUB4', name: 'Itaú Unibanco PN', b3_type: 'stock' },
      trade_date: '2026-01-10',
      quantity: '100',
      unit_price: '30.00',
      fees: '0',
    });
  itub4 = compra.body.transaction.asset_id;
});

const registrar = (body: Record<string, unknown>) =>
  request(harness.app)
    .post('/api/corporate-events')
    .send({
      asset_id: itub4,
      kind: 'split',
      record_date: '2026-06-10',
      ratio_from: '1',
      ratio_to: '2',
      ...body,
    });

const posicao = async (): Promise<{
  quantity: string;
  avg_price: string;
  cost: string;
}> => {
  // O efeito aparece no preview de um lançamento novo: o "antes" é a posição.
  const preview = await request(harness.app).post('/api/transactions/preview').send({
    kind: 'buy',
    portfolio_id: carteira,
    institution_id: corretora,
    asset_id: itub4,
    trade_date: '2026-12-31',
    quantity: '0',
    unit_price: '0',
    fees: '0',
  });

  return {
    quantity: preview.body.preview.position.quantity.before,
    avg_price: preview.body.preview.position.avg_price.before,
    cost: preview.body.preview.position.cost_basis.before,
  };
};

describe('evento corporativo', () => {
  it('registrar não aplica: o evento fica aguardando confirmação', async () => {
    const response = await registrar({});

    expect(response.status).toBe(201);
    const event = corporateEventResourceSchema.parse(response.body.event);
    expect(event.confirmed_at).toBeNull();

    expect((await posicao()).quantity).toBe('100.00000000');
  });

  it('reanunciar o mesmo evento não cria uma segunda linha', async () => {
    await registrar({});
    await registrar({});

    const lista = await request(harness.app).get('/api/corporate-events?pending=true');
    expect(lista.body.events).toHaveLength(1);
  });

  it('desdobramento 1:2 dobra a quantidade, divide o preço médio e mantém o custo', async () => {
    const evento = await registrar({});

    const response = await request(harness.app)
      .post(`/api/corporate-events/${evento.body.event.id}/confirm`)
      .send({});

    expect(response.status).toBe(200);

    const depois = await posicao();
    expect(depois.quantity).toBe('200.00000000');
    expect(depois.avg_price).toBe('15.00000000');
    expect(depois.cost).toBe('3000.00');
  });

  it('grupamento 10:1 com quantidade ímpar trata a sobra como fração', async () => {
    await request(harness.app).post('/api/transactions').send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretora,
      asset_id: itub4,
      trade_date: '2026-02-10',
      quantity: '5',
      unit_price: '30.00',
      fees: '0',
    });

    const evento = await registrar({
      kind: 'reverse_split',
      ratio_from: '10',
      ratio_to: '1',
    });
    await request(harness.app)
      .post(`/api/corporate-events/${evento.body.event.id}/confirm`)
      .send({});

    const depois = await posicao();
    expect(depois.quantity).toBe('10.50000000');
    expect(depois.cost).toBe('3150.00');
  });

  it('a aplicação vira lançamento e enfileira recálculo a partir da data-com', async () => {
    const evento = await registrar({});

    const response = await request(harness.app)
      .post(`/api/corporate-events/${evento.body.event.id}/confirm`)
      .send({});

    expect(response.body.transactions).toHaveLength(1);
    expect(response.body.transactions[0].kind).toBe('corporate_event');
    expect(response.body.recalculation[0].dedupe_key).toBe(`recalc:${carteira}`);

    const [outbox] = await harness.sql<{ from_date: string }[]>`
      select payload ->> 'from_date' as from_date
        from pipeline_outbox where stage = 'recalc'
    `;
    expect(outbox?.from_date).toBe('2026-06-10');
  });

  it('confirmar duas vezes é recusado', async () => {
    const evento = await registrar({});
    const url = `/api/corporate-events/${evento.body.event.id}/confirm`;

    await request(harness.app).post(url).send({});
    const segunda = await request(harness.app).post(url).send({});

    expect(segunda.status).toBe(409);
  });

  it('evento em ativo sem posição na data-com não é aplicado', async () => {
    const evento = await registrar({ record_date: '2025-01-10' });

    const response = await request(harness.app)
      .post(`/api/corporate-events/${evento.body.event.id}/confirm`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/posição/);
  });
});
