import { assetResourceSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

let harness: ApiHarness;
let bancoC: string;

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);
  bancoC = await seedInstitution(harness.sql, 'Banco C');
});

const cadastrarTitulo = (body: Record<string, unknown>) =>
  request(harness.app)
    .post('/api/assets')
    .send({
      origin: 'manual',
      kind: 'cdb',
      issuer_id: bancoC,
      indexer: 'cdi_pct',
      rate: '112',
      issued_at: '2026-10-06',
      maturity_date: '2028-10-06',
      liquidity: 'at_maturity',
      tax_regime: 'regressive',
      ...body,
    });

describe('título de renda fixa cadastrado à mão', () => {
  it('o nome exibido é gerado a partir do emissor, do vencimento e da taxa', async () => {
    const response = await cadastrarTitulo({});

    expect(response.status).toBe(201);
    const asset = assetResourceSchema.parse(response.body.asset);
    expect(asset.name).toBe('CDB · Banco C · 10/2028 · 112% CDI');
    expect(asset.origin).toBe('manual');
    expect(asset.issuer_id).toBe(bancoC);
  });

  it('o nome gerado é editável: o que vem no corpo vence', async () => {
    const response = await cadastrarTitulo({ name: 'CDB do bônus' });

    expect(response.body.asset.name).toBe('CDB do bônus');
  });

  it('o preço vem da curva, não de provedor', async () => {
    const response = await cadastrarTitulo({});

    expect(response.body.asset.price_source).toBe('manual');
    expect(response.body.asset.b3_type).toBeNull();
  });

  it('a classe sai do indexador, pela regra automática', async () => {
    const posFixada = await request(harness.app)
      .post('/api/categories')
      .send({
        name: 'RF pós-fixada',
        color_token: 'class.rf-pos',
        auto_rule: { indexer: 'cdi_pct' },
      });

    const response = await cadastrarTitulo({});

    expect(response.body.asset.category_id).toBe(posFixada.body.category.id);
  });

  it('dois títulos do mesmo emissor e vencimento ganham códigos diferentes', async () => {
    const primeiro = await cadastrarTitulo({});
    const segundo = await cadastrarTitulo({ rate: '105' });

    expect(primeiro.body.asset.ticker).not.toBe(segundo.body.asset.ticker);
    expect(segundo.body.asset.ticker).toMatch(/-2$/);
  });

  it('vencimento antes da aplicação é recusado', async () => {
    const response = await cadastrarTitulo({
      issued_at: '2028-10-06',
      maturity_date: '2026-10-06',
    });

    expect(response.status).toBe(400);
  });

  it('liquidez D+n sem o número de dias é recusada', async () => {
    const response = await cadastrarTitulo({ liquidity: 'd_plus_n' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/dias/);
  });

  it('LCI declarada com tabela regressiva é recusada: ela é isenta', async () => {
    const response = await cadastrarTitulo({ kind: 'lci', tax_regime: 'regressive' });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/isento/);
  });

  it('LCI isenta é aceita, e o regime fica gravado', async () => {
    const response = await cadastrarTitulo({ kind: 'lci', tax_regime: 'exempt' });

    expect(response.status).toBe(201);
    expect(response.body.asset.tax_regime).toBe('exempt');
  });

  it('emissor inexistente é recusado antes de gravar', async () => {
    const response = await cadastrarTitulo({
      issuer_id: '0b4cf1d2-9b3a-4f4e-9f1a-000000000000',
    });

    expect(response.status).toBe(400);
  });
});
