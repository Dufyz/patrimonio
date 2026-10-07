import { manualPricePreviewSchema } from '@patrimonio/contracts';
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
let knri11: string;

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
      asset: { ticker: 'KNRI11', name: 'Kinea Renda Imobiliária', b3_type: 'fii' },
      trade_date: '2026-06-10',
      quantity: '105',
      unit_price: '158.90',
      fees: '0',
    });
  knri11 = compra.body.transaction.asset_id;
});

const definirPreco = (body: Record<string, unknown>) =>
  request(harness.app)
    .post(`/api/assets/${knri11}/manual-price`)
    .send({ price_date: '2026-10-06', price: '159.40', ...body });

describe('preço manual', () => {
  it('é gravado por data e aparece na lista do ativo', async () => {
    const response = await definirPreco({});

    expect(response.status).toBe(200);
    expect(response.body.manual_price.price).toBe('159.40000000');

    const lista = await request(harness.app).get(`/api/assets/${knri11}/manual-prices`);
    expect(lista.body.manual_prices).toHaveLength(1);
  });

  it('o preview mostra o efeito no valor da posição', async () => {
    const response = await definirPreco({});

    const preview = manualPricePreviewSchema.parse(response.body.preview);
    expect(preview.quantity).toBe('105.00000000');
    // Sem preço anterior, a base é o custo: 105 × 158,90.
    expect(preview.previous_source).toBe('cost');
    expect(preview.position_value.before).toBe('16684.50');
    expect(preview.position_value.after).toBe('16737.00');
  });

  it('redefinir o preço do mesmo dia atualiza a linha, em vez de criar outra', async () => {
    await definirPreco({});
    const segunda = await definirPreco({ price: '160.00' });

    expect(segunda.body.manual_price.price).toBe('160.00000000');
    expect(segunda.body.preview.previous_source).toBe('manual');

    const lista = await request(harness.app).get(`/api/assets/${knri11}/manual-prices`);
    expect(lista.body.manual_prices).toHaveLength(1);
  });

  it('o preço anterior vira a base do "antes" na próxima definição', async () => {
    await definirPreco({ price_date: '2026-10-05', price: '150.00' });

    const segunda = await definirPreco({ price_date: '2026-10-06', price: '159.40' });

    expect(segunda.body.preview.previous_price).toBe('150.00000000');
    expect(segunda.body.preview.position_value.before).toBe('15750.00');
  });

  it('data que não é dia de pregão é recusada', async () => {
    // 2026-10-04 é um domingo.
    const response = await definirPreco({ price_date: '2026-10-04' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/dia útil/);
  });

  it('ativo inexistente devolve 404', async () => {
    const response = await request(harness.app)
      .post('/api/assets/0b4cf1d2-9b3a-4f4e-9f1a-000000000000/manual-price')
      .send({ price_date: '2026-10-06', price: '10' });

    expect(response.status).toBe(404);
  });

  it('remover o preço devolve o ativo à fonte automática', async () => {
    await definirPreco({});

    const removido = await request(harness.app).delete(
      `/api/assets/${knri11}/manual-price/2026-10-06`,
    );

    expect(removido.status).toBe(200);

    const lista = await request(harness.app).get(`/api/assets/${knri11}/manual-prices`);
    expect(lista.body.manual_prices).toHaveLength(0);
  });
});
