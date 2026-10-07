import { categoryResourceSchema } from '@patrimonio/contracts';
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
  request(harness.app).post('/api/categories').send(body);

describe('categoria em dois níveis', () => {
  it('grupo nasce sem pai', async () => {
    const response = await criar({ name: 'Renda fixa', color_token: 'class.rf' });

    expect(response.status).toBe(201);
    expect(categoryResourceSchema.parse(response.body.category).parent_id).toBeNull();
  });

  it('categoria entra dentro de um grupo', async () => {
    const grupo = await criar({ name: 'Renda fixa', color_token: 'class.rf' });

    const filha = await criar({
      name: 'RF inflação',
      color_token: 'class.rf-inflacao',
      parent_id: grupo.body.category.id,
    });

    expect(filha.status).toBe(201);
    expect(filha.body.category.parent_id).toBe(grupo.body.category.id);
  });

  it('terceiro nível é recusado, e a resposta diz por quê', async () => {
    const grupo = await criar({ name: 'Renda fixa', color_token: 'class.rf' });
    const filha = await criar({
      name: 'RF inflação',
      color_token: 'class.rf-inflacao',
      parent_id: grupo.body.category.id,
    });

    const neta = await criar({
      name: 'Tesouro IPCA',
      color_token: 'class.rf-inflacao',
      parent_id: filha.body.category.id,
    });

    expect(neta.status).toBe(400);
    expect(neta.body.message).toMatch(/dois níveis/);
  });

  it('cor em hex é recusada: a cor é token do design system', async () => {
    const response = await criar({ name: 'Ações', color_token: '#2563eb' });

    expect(response.status).toBe(400);
  });

  it('regra automática é guardada como veio', async () => {
    const response = await criar({
      name: 'FIIs',
      color_token: 'class.fii',
      auto_rule: { b3_type: 'fii' },
    });

    expect(response.body.category.auto_rule).toEqual({ b3_type: 'fii' });
  });

  it('nome repetido no mesmo nível é conflito', async () => {
    await criar({ name: 'Ações', color_token: 'class.stock' });
    const repetida = await criar({ name: 'ações', color_token: 'class.stock' });

    expect(repetida.status).toBe(409);
  });

  it('o mesmo nome em grupos diferentes é permitido', async () => {
    const rf = await criar({ name: 'Renda fixa', color_token: 'class.rf' });
    const rv = await criar({ name: 'Renda variável', color_token: 'class.stock' });

    const primeira = await criar({
      name: 'Pós-fixada',
      color_token: 'class.rf-pos',
      parent_id: rf.body.category.id,
    });
    const segunda = await criar({
      name: 'Pós-fixada',
      color_token: 'class.rf-pos',
      parent_id: rv.body.category.id,
    });

    expect(primeira.status).toBe(201);
    expect(segunda.status).toBe(201);
  });
});

describe('editar e excluir categoria', () => {
  it('renomear mantém o id, que é o vínculo com os ativos', async () => {
    const criada = await criar({ name: 'Ações', color_token: 'class.stock' });

    const renomeada = await request(harness.app)
      .patch(`/api/categories/${criada.body.category.id}`)
      .send({ name: 'Ações BR' });

    expect(renomeada.status).toBe(200);
    expect(renomeada.body.category.id).toBe(criada.body.category.id);
  });

  it('grupo com categorias dentro não pode ser excluído', async () => {
    const grupo = await criar({ name: 'Renda fixa', color_token: 'class.rf' });
    await criar({
      name: 'RF inflação',
      color_token: 'class.rf-inflacao',
      parent_id: grupo.body.category.id,
    });

    const response = await request(harness.app).delete(
      `/api/categories/${grupo.body.category.id}`,
    );

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/1 categoria/);
  });

  it('categoria sem uso é excluída', async () => {
    const criada = await criar({ name: 'Ações', color_token: 'class.stock' });

    const response = await request(harness.app).delete(
      `/api/categories/${criada.body.category.id}`,
    );

    expect(response.status).toBe(200);
  });
});
