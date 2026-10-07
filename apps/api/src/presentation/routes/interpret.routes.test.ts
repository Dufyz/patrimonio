import { textInterpretationSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);
});

const interpretar = (text: string) =>
  request(harness.app).post('/api/transactions/interpret').send({ text });

describe('lançamento por texto', () => {
  it('interpreta a linha e devolve as pastilhas', async () => {
    const response = await interpretar('compra 100 itub4 36,84 ontem');

    expect(response.status).toBe(200);
    const interpretation = textInterpretationSchema.parse(response.body.interpretation);
    expect(interpretation.kind).toBe('buy');
    expect(interpretation.ticker).toBe('ITUB4');
    expect(interpretation.quantity).toBe('100');
    expect(interpretation.unit_price).toBe('36.84');
    expect(interpretation.total_amount).toBe('3684.00');
    expect(interpretation.ambiguous).toBe(false);
  });

  it('resolve o ativo contra o cadastro quando ele já existe', async () => {
    await request(harness.app)
      .post('/api/assets')
      .send({ ticker: 'ITUB4', name: 'Itaú Unibanco PN', b3_type: 'stock' });

    const response = await interpretar('compra 100 itub4 36,84');

    expect(response.body.interpretation.asset.ticker).toBe('ITUB4');
  });

  it('ativo que ainda não existe volta sem cadastro e sem candidato inventado', async () => {
    const response = await interpretar('compra 100 taee11 36,84');

    expect(response.body.interpretation.asset).toBeNull();
    expect(response.body.interpretation.candidates).toEqual([]);
  });

  it('código digitado pela metade devolve o que se parece', async () => {
    await request(harness.app)
      .post('/api/assets')
      .send({ ticker: 'ITUB4', name: 'Itaú Unibanco PN', b3_type: 'stock' });

    const response = await interpretar('compra 100 itub 36,84');

    expect(response.body.interpretation.asset).toBeNull();
    expect(response.body.interpretation.candidates[0].ticker).toBe('ITUB4');
  });

  it('texto ambíguo não salva: ele diz o que falta', async () => {
    const response = await interpretar('100 itub4 36,84');

    expect(response.body.interpretation.ambiguous).toBe(true);
    expect(response.body.interpretation.missing).toContain('tipo do lançamento');

    const extrato = await request(harness.app).get('/api/transactions');
    expect(extrato.body.total).toBe(0);
  });

  it('interpretar nunca grava nada', async () => {
    await interpretar('compra 100 itub4 36,84 ontem');

    const extrato = await request(harness.app).get('/api/transactions');
    const ativos = await request(harness.app).get('/api/assets');

    expect(extrato.body.total).toBe(0);
    expect(ativos.body.assets).toHaveLength(0);
  });
});
