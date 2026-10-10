import { institutionResourceSchema } from '@patrimonio/contracts';
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
  it('sem país, a instituição é brasileira', async () => {
    const response = await criar({ name: 'Corretora A' });

    expect(response.status).toBe(201);
    expect(institutionResourceSchema.parse(response.body.institution).country).toBe('BR');
  });

  it('o país estrangeiro é aceito, e minúsculas viram maiúsculas', async () => {
    const response = await criar({ name: 'Interactive Brokers', country: 'us' });

    expect(response.status).toBe(201);
    expect(response.body.institution.country).toBe('US');
  });

  it('país que não é de duas letras é recusado', async () => {
    const response = await criar({ name: 'Corretora C', country: 'USA' });

    expect(response.status).toBe(400);
  });

  it('nome repetido vira conflito', async () => {
    await criar({ name: 'Banco C' });
    const repetido = await criar({ name: 'banco c' });

    expect(repetido.status).toBe(409);
  });
});

describe('excluir instituição', () => {
  it('sem histórico, é excluída', async () => {
    const criada = await criar({ name: 'Corretora A' });

    const response = await request(harness.app).delete(
      `/api/institutions/${criada.body.institution.id}`,
    );

    expect(response.status).toBe(200);
  });
});
