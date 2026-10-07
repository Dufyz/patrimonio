import { assetResourceSchema } from '@patrimonio/contracts';
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

const criarCategoria = (body: Record<string, unknown>) =>
  request(harness.app).post('/api/categories').send(body);

const criarAtivo = (body: Record<string, unknown>) =>
  request(harness.app).post('/api/assets').send(body);

describe('ativo da base de mercado', () => {
  it('é cadastrado com origem de mercado e o código em maiúsculas', async () => {
    const response = await criarAtivo({
      ticker: 'itub4',
      name: 'Itaú Unibanco PN',
      b3_type: 'stock',
    });

    expect(response.status).toBe(201);
    const asset = assetResourceSchema.parse(response.body.asset);
    expect(asset.ticker).toBe('ITUB4');
    expect(asset.origin).toBe('market');
  });

  it('cai na categoria cuja regra automática ele cumpre', async () => {
    const fiis = await criarCategoria({
      name: 'FIIs',
      color_token: 'class.fii',
      auto_rule: { b3_type: 'fii' },
    });
    await criarCategoria({
      name: 'Ações',
      color_token: 'class.stock',
      auto_rule: { b3_type: 'stock' },
    });

    const response = await criarAtivo({
      ticker: 'KNRI11',
      name: 'Kinea Renda Imobiliária',
      b3_type: 'fii',
    });

    expect(response.body.asset.category_id).toBe(fiis.body.category.id);
  });

  it('a categoria informada no cadastro fica acima da regra automática', async () => {
    await criarCategoria({
      name: 'FIIs',
      color_token: 'class.fii',
      auto_rule: { b3_type: 'fii' },
    });
    const outra = await criarCategoria({ name: 'Híbridos', color_token: 'class.fii' });

    const response = await criarAtivo({
      ticker: 'KNRI11',
      name: 'Kinea Renda Imobiliária',
      b3_type: 'fii',
      category_id: outra.body.category.id,
    });

    expect(response.body.asset.category_id).toBe(outra.body.category.id);
  });

  it('ativo que não cumpre regra nenhuma fica sem categoria, e não numa qualquer', async () => {
    await criarCategoria({
      name: 'FIIs',
      color_token: 'class.fii',
      auto_rule: { b3_type: 'fii' },
    });

    const response = await criarAtivo({ ticker: 'BBAS3', name: 'Banco do Brasil ON' });

    expect(response.body.asset.category_id).toBeNull();
  });

  it('código repetido é conflito', async () => {
    await criarAtivo({ ticker: 'ITUB4', name: 'Itaú Unibanco PN' });
    const repetido = await criarAtivo({ ticker: 'itub4', name: 'Outro nome' });

    expect(repetido.status).toBe(409);
  });

  it('Tesouro tem vencimento e preço de mercado ao mesmo tempo', async () => {
    const response = await criarAtivo({
      ticker: 'TESOURO-IPCA-2029',
      name: 'Tesouro IPCA+ 2029',
      b3_type: 'treasury',
      maturity_date: '2029-05-15',
      indexer: 'ipca_plus',
      rate: '6.12',
    });

    expect(response.status).toBe(201);
    expect(response.body.asset.origin).toBe('market');
    expect(response.body.asset.maturity_date).toBe('2029-05-15');
  });
});

describe('busca de ativo', () => {
  it('encontra por código e por nome, sem distinguir maiúscula', async () => {
    await criarAtivo({ ticker: 'ITUB4', name: 'Itaú Unibanco PN' });
    await criarAtivo({ ticker: 'KNRI11', name: 'Kinea Renda Imobiliária' });

    const porCodigo = await request(harness.app).get('/api/assets?search=itub');
    const porNome = await request(harness.app).get('/api/assets?search=kinea');

    expect(porCodigo.body.assets).toHaveLength(1);
    expect(porNome.body.assets[0].ticker).toBe('KNRI11');
  });

  it('arquivado some da busca e volta com include_archived', async () => {
    const criado = await criarAtivo({ ticker: 'ITUB4', name: 'Itaú Unibanco PN' });
    await request(harness.app)
      .post(`/api/assets/${criado.body.asset.id}/archive`)
      .send({ archived: true });

    const padrao = await request(harness.app).get('/api/assets');
    const completa = await request(harness.app).get('/api/assets?include_archived=true');

    expect(padrao.body.assets).toHaveLength(0);
    expect(completa.body.assets).toHaveLength(1);
  });
});

describe('editar, arquivar e excluir', () => {
  it('classe e setor são editáveis', async () => {
    const criado = await criarAtivo({ ticker: 'KNRI11', name: 'Kinea Renda' });

    const response = await request(harness.app)
      .patch(`/api/assets/${criado.body.asset.id}`)
      .send({ sector: 'Híbrido', b3_type: 'fii' });

    expect(response.status).toBe(200);
    expect(response.body.asset.sector).toBe('Híbrido');
    expect(response.body.asset.b3_type).toBe('fii');
  });

  it('ativo sem posição pode ser arquivado', async () => {
    const criado = await criarAtivo({ ticker: 'TAEE11', name: 'Taesa Unit' });

    const response = await request(harness.app)
      .post(`/api/assets/${criado.body.asset.id}/archive`)
      .send({ archived: true });

    expect(response.status).toBe(200);
    expect(response.body.asset.archived_at).not.toBeNull();
  });

  it('ativo sem lançamento é excluído', async () => {
    const criado = await criarAtivo({ ticker: 'TAEE11', name: 'Taesa Unit' });

    const response = await request(harness.app).delete(
      `/api/assets/${criado.body.asset.id}`,
    );

    expect(response.status).toBe(200);
  });
});
