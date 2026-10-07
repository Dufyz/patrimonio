import {
  fgcExposureResourceSchema,
  institutionResourceSchema,
} from '@patrimonio/contracts';
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

const criar = (body: Record<string, unknown>) =>
  request(harness.app).post('/api/institutions').send(body);

describe('cadastro de instituição', () => {
  it('o papel pode ser custodiante, emissor ou os dois', async () => {
    const response = await criar({ name: 'Corretora A', role: 'custodian' });

    expect(response.status).toBe(201);
    expect(institutionResourceSchema.parse(response.body.institution).role).toBe(
      'custodian',
    );
  });

  it('corretagem por ordem e custódia mensal são configuráveis', async () => {
    const response = await criar({
      name: 'Corretora B',
      role: 'both',
      brokerage_per_order: '4.90',
      custody_monthly_fee: '12.50',
    });

    expect(response.body.institution.brokerage_per_order).toBe('4.90');
    expect(response.body.institution.custody_monthly_fee).toBe('12.50');
  });

  it('corretagem negativa é recusada', async () => {
    const response = await criar({
      name: 'Corretora C',
      role: 'both',
      brokerage_per_order: '-1',
    });

    expect(response.status).toBe(400);
  });

  it('nome repetido vira conflito', async () => {
    await criar({ name: 'Banco C', role: 'issuer' });
    const repetido = await criar({ name: 'banco c', role: 'issuer' });

    expect(repetido.status).toBe(409);
  });
});

describe('exposição ao FGC', () => {
  it('sem título do emissor, o teto inteiro está disponível', async () => {
    const criada = await criar({ name: 'Banco C', role: 'issuer' });

    const response = await request(harness.app).get(
      `/api/institutions/${criada.body.institution.id}/fgc-exposure`,
    );

    expect(response.status).toBe(200);
    const exposure = fgcExposureResourceSchema.parse(response.body.exposure);
    expect(exposure.exposure_brl).toBe('0.00');
    expect(exposure.available_brl).toBe('250000.00');
    expect(exposure.over_limit).toBe(false);
  });

  it('instituição inexistente devolve 404', async () => {
    const response = await request(harness.app).get(
      '/api/institutions/0b4cf1d2-9b3a-4f4e-9f1a-000000000000/fgc-exposure',
    );

    expect(response.status).toBe(404);
  });
});

describe('excluir instituição', () => {
  it('sem histórico, é excluída', async () => {
    const criada = await criar({ name: 'Corretora A', role: 'both' });

    const response = await request(harness.app).delete(
      `/api/institutions/${criada.body.institution.id}`,
    );

    expect(response.status).toBe(200);
  });
});
