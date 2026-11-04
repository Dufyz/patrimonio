import { institutionResourceSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApiHarness, resetSourceTables, seedInstitution } from '../../testing/harness.js';
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

describe('catálogo de instituições', () => {
  it('lista o catálogo em ordem alfabética, sem acento nem caixa', async () => {
    await seedInstitution(harness.sql, 'Banco Inter');
    await seedInstitution(harness.sql, 'Ágora Corretora');

    const response = await request(harness.app).get('/api/institutions');

    expect(response.status).toBe(200);
    const names = (response.body.institutions as unknown[]).map(
      (item) => institutionResourceSchema.parse(item).name,
    );
    expect(names).toEqual(['Ágora Corretora', 'Banco Inter']);
  });

  it('não aceita cadastro, edição nem exclusão pela api', async () => {
    const criar = await request(harness.app).post('/api/institutions').send({ name: 'X' });
    const editar = await request(harness.app)
      .patch('/api/institutions/00000000-0000-7000-8000-000000000000')
      .send({ name: 'Y' });
    const excluir = await request(harness.app).delete(
      '/api/institutions/00000000-0000-7000-8000-000000000000',
    );

    expect([criar.status, editar.status, excluir.status]).toEqual([404, 404, 404]);
  });
});
