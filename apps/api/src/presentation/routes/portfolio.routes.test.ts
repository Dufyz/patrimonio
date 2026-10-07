import { portfolioResourceSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedCategory,
} from '../../testing/harness.js';
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
  request(harness.app).post('/api/portfolios').send(body);

describe('criar carteira', () => {
  it('a carteira criada volta no formato do contrato', async () => {
    const response = await criar({ name: 'Longo prazo', purpose: 'Independência' });

    expect(response.status).toBe(201);
    const portfolio = portfolioResourceSchema.parse(response.body.portfolio);
    expect(portfolio.name).toBe('Longo prazo');
    expect(portfolio.recalc_status).toBe('idle');
  });

  it('nome repetido entre carteiras ativas é recusado', async () => {
    await criar({ name: 'Longo prazo' });
    const repetido = await criar({ name: 'longo prazo' });

    expect(repetido.status).toBe(409);
    expect(repetido.body.message).toMatch(/Já existe/);
  });

  it('o nome volta a ficar livre depois de arquivar', async () => {
    const primeira = await criar({ name: 'Reserva' });
    await request(harness.app)
      .post(`/api/portfolios/${primeira.body.portfolio.id}/archive`)
      .send({ archived: true });

    const segunda = await criar({ name: 'Reserva' });

    expect(segunda.status).toBe(201);
  });

  it('alvo de alocação que soma 96% trava o salvamento e aponta a diferença', async () => {
    const acoes = await seedCategory(harness.sql, 'Ações');
    const fiis = await seedCategory(harness.sql, 'FIIs');

    const response = await criar({
      name: 'Longo prazo',
      allocation_targets: [
        { category_id: acoes, target_pct: '60' },
        { category_id: fiis, target_pct: '36' },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('96.00');
    expect(response.body.message).toContain('4.00');
  });

  it('alvo que fecha 100% é gravado junto com a carteira', async () => {
    const acoes = await seedCategory(harness.sql, 'Ações');
    const fiis = await seedCategory(harness.sql, 'FIIs');

    const criada = await criar({
      name: 'Longo prazo',
      allocation_targets: [
        { category_id: acoes, target_pct: '60' },
        { category_id: fiis, target_pct: '40' },
      ],
    });

    const detalhe = await request(harness.app).get(
      `/api/portfolios/${criada.body.portfolio.id}`,
    );

    expect(detalhe.status).toBe(200);
    expect(detalhe.body.allocation_targets).toHaveLength(2);
  });

  it('recalc_status no corpo é ignorado: só a máquina de estados o escreve', async () => {
    const response = await criar({ name: 'Longo prazo', recalc_status: 'running' });

    expect(response.status).toBe(201);
    expect(response.body.portfolio.recalc_status).toBe('idle');
  });
});

describe('listar carteiras', () => {
  it('arquivada some da lista e volta com include_archived', async () => {
    const criada = await criar({ name: 'Antiga' });
    await request(harness.app)
      .post(`/api/portfolios/${criada.body.portfolio.id}/archive`)
      .send({ archived: true });

    const padrao = await request(harness.app).get('/api/portfolios');
    const comArquivadas = await request(harness.app).get(
      '/api/portfolios?include_archived=true',
    );

    expect(padrao.body.portfolios).toHaveLength(0);
    expect(comArquivadas.body.portfolios).toHaveLength(1);
  });
});

describe('editar carteira', () => {
  it('tolerância e modo de rebalanceamento são editáveis', async () => {
    const criada = await criar({ name: 'Longo prazo' });

    const response = await request(harness.app)
      .patch(`/api/portfolios/${criada.body.portfolio.id}`)
      .send({
        tolerance_pp: '3',
        rebalance_mode: 'buy_and_sell',
        review_every_months: 6,
      });

    expect(response.status).toBe(200);
    expect(Number(response.body.portfolio.tolerance_pp)).toBe(3);
    expect(response.body.portfolio.rebalance_mode).toBe('buy_and_sell');
    expect(response.body.portfolio.review_every_months).toBe(6);
  });

  it('carteira inexistente devolve 404', async () => {
    const response = await request(harness.app)
      .patch('/api/portfolios/0b4cf1d2-9b3a-4f4e-9f1a-000000000000')
      .send({ name: 'Qualquer' });

    expect(response.status).toBe(404);
  });
});

describe('estratégia', () => {
  it('substituir o alvo inteiro troca as linhas de uma vez', async () => {
    const acoes = await seedCategory(harness.sql, 'Ações');
    const fiis = await seedCategory(harness.sql, 'FIIs');
    const criada = await criar({
      name: 'Longo prazo',
      allocation_targets: [
        { category_id: acoes, target_pct: '60' },
        { category_id: fiis, target_pct: '40' },
      ],
    });

    const response = await request(harness.app)
      .put(`/api/portfolios/${criada.body.portfolio.id}/strategy`)
      .send({
        targets: [
          { category_id: acoes, target_pct: '30' },
          { category_id: fiis, target_pct: '70' },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.targets).toHaveLength(2);
  });

  it('lista vazia é "sem estratégia definida", e não erro', async () => {
    const criada = await criar({ name: 'Longo prazo' });

    const response = await request(harness.app)
      .put(`/api/portfolios/${criada.body.portfolio.id}/strategy`)
      .send({ targets: [] });

    expect(response.status).toBe(200);
    expect(response.body.targets).toEqual([]);
  });
});

describe('excluir carteira', () => {
  it('sem o nome digitado corretamente não exclui', async () => {
    const criada = await criar({ name: 'Curto prazo' });

    const response = await request(harness.app)
      .delete(`/api/portfolios/${criada.body.portfolio.id}`)
      .send({ confirm_name: 'curto', transactions: 'delete' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/não confere/);
  });

  it('carteira vazia é excluída e some da lista', async () => {
    const criada = await criar({ name: 'Curto prazo' });

    const response = await request(harness.app)
      .delete(`/api/portfolios/${criada.body.portfolio.id}`)
      .send({ confirm_name: 'Curto prazo', transactions: 'delete' });

    expect(response.status).toBe(200);

    const lista = await request(harness.app).get('/api/portfolios');
    expect(lista.body.portfolios).toHaveLength(0);
  });

  it('mover o conteúdo sem dizer para onde é recusado', async () => {
    const criada = await criar({ name: 'Curto prazo' });

    const response = await request(harness.app)
      .delete(`/api/portfolios/${criada.body.portfolio.id}`)
      .send({ confirm_name: 'Curto prazo', transactions: 'move' });

    expect(response.status).toBe(400);
  });
});
