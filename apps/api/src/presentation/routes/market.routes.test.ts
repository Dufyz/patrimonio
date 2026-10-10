import { assetPriceSeriesSchema, marketHealthSchema } from '@patrimonio/contracts';
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
let ativo: string;

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
  corretora = await seedInstitution(harness.sql, 'Corretora Mercado');

  const compra = await request(harness.app)
    .post('/api/transactions')
    .send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretora,
      asset: { ticker: 'MKTR4', name: 'Ação da rota', b3_type: 'stock' },
      trade_date: '2026-10-01',
      quantity: '100',
      unit_price: '30.00',
      fees: '0',
    });
  ativo = compra.body.transaction.asset_id;
});

const gravarPreco = async (date: string, close: string) => {
  await harness.sql`
    INSERT INTO asset_price (asset_id, price_date, close, source, source_kind)
    VALUES (${ativo}, ${date}, ${close}, 'brapi', 'primary')
    ON CONFLICT (asset_id, price_date) DO UPDATE SET close = EXCLUDED.close
  `;
};

const registrarColeta = async (overrides: Record<string, unknown> = {}) => {
  await harness.sql`
    INSERT INTO market_source_run (
      id, source, kind, reference_date, started_at, finished_at, ok, source_kind,
      requests, items, missing, error
    )
    VALUES (
      GEN_RANDOM_UUID(),
      ${String(overrides['source'] ?? 'brapi')},
      ${String(overrides['kind'] ?? 'quotes')}::market_run_kind,
      ${(overrides['reference_date'] ?? '2026-10-06') as string},
      ${(overrides['started_at'] ?? '2026-10-06T21:30:00.000Z') as string},
      ${(overrides['finished_at'] ?? '2026-10-06T21:30:12.000Z') as string},
      ${(overrides['ok'] ?? true) as boolean},
      ${(overrides['source_kind'] ?? 'primary') as string}::price_source_kind,
      ${(overrides['requests'] ?? 30) as number},
      ${(overrides['items'] ?? 30) as number},
      ${(overrides['missing'] ?? 0) as number},
      ${(overrides['error'] ?? null) as string | null}
    )
  `;
};

describe('situação dos dados de mercado', () => {
  it('a resposta valida contra o schema do contrato', async () => {
    await registrarColeta();

    const response = await request(harness.app).get(
      '/api/market/health?on_date=2026-10-06',
    );

    expect(response.status).toBe(200);
    expect(() => marketHealthSchema.parse(response.body)).not.toThrow();
  });

  it('cada fonte mostra situação, horário da última coleta e cobertura', async () => {
    await registrarColeta({ items: 28, missing: 2 });

    const { body } = await request(harness.app).get(
      '/api/market/health?on_date=2026-10-06',
    );

    const brapi = body.sources.find(
      (source: { source: string }) => source.source === 'brapi',
    );

    expect(brapi.status).toBe('ok');
    expect(brapi.last_run.finished_at).toBe('2026-10-06T21:30:12.000Z');
    expect(brapi.coverage).toEqual({ items: 28, missing: 2 });
  });

  it('o consumo da cota aparece contra o teto do plano', async () => {
    await registrarColeta({ requests: 600 });

    const { body } = await request(harness.app).get(
      '/api/market/health?on_date=2026-10-06',
    );

    const brapi = body.sources.find(
      (source: { source: string }) => source.source === 'brapi',
    );

    expect(brapi.budget).toMatchObject({
      used: 600,
      ceiling: 15_000,
      warning: false,
      exceeded: false,
    });
  });

  it('a falha recente aparece com a mensagem do erro, não com um código', async () => {
    await registrarColeta({
      ok: false,
      error: 'brapi respondeu 503',
      source_kind: null,
      items: 0,
    });

    const { body } = await request(harness.app).get(
      '/api/market/health?on_date=2026-10-06',
    );

    expect(body.recent_failures[0].error).toBe('brapi respondeu 503');
    expect(
      body.sources.find((source: { source: string }) => source.source === 'brapi').status,
    ).toBe('failing');
  });

  it('coleta antiga aparece como stale, que não é falha', async () => {
    await registrarColeta({
      reference_date: '2026-09-01',
      started_at: '2026-09-01T21:30:00.000Z',
      finished_at: '2026-09-01T21:30:12.000Z',
    });

    const { body } = await request(harness.app).get(
      '/api/market/health?on_date=2026-10-06',
    );

    expect(
      body.sources.find((source: { source: string }) => source.source === 'brapi').status,
    ).toBe('stale');
  });

  it('ativo sem preço do dia aparece listado, pronto para preço manual', async () => {
    await gravarPreco('2026-10-01', '30.00');

    // A posição do dia precisa existir para a consulta achar o papel sem preço.
    await harness.sql`
      INSERT INTO position_daily (
        portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
        market_value, price_source_kind
      )
      VALUES (
        ${carteira}, ${ativo}, '2026-10-01', 100, 30, 3000, 3000, 'fresh'
      )
    `;

    const { body } = await request(harness.app).get(
      '/api/market/health?on_date=2026-10-06',
    );

    expect(body.missing_prices).toHaveLength(1);
    expect(body.missing_prices[0]).toMatchObject({
      ticker: 'MKTR4',
      last_price_date: '2026-10-01',
    });
  });

  it('fonte que nunca rodou não aparece como falha', async () => {
    const { body } = await request(harness.app).get(
      '/api/market/health?on_date=2026-10-06',
    );

    expect(body.sources).toEqual([]);
    expect(body.recent_failures).toEqual([]);
  });
});

describe('atualizar agora', () => {
  it('enfileira e devolve retorno imediato com job_id', async () => {
    const response = await request(harness.app)
      .post('/api/market/refresh')
      .send({ on_date: '2026-10-06' });

    expect(response.status).toBe(202);
    expect(response.body.job_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(response.body.dedupe_key).toBe('market:2026-10-06');
    expect(response.body.already_queued).toBe(false);
  });

  it('dois pedidos seguidos viram uma coleta', async () => {
    const primeiro = await request(harness.app).post('/api/market/refresh').send({});
    const segundo = await request(harness.app).post('/api/market/refresh').send({});

    expect(segundo.body.already_queued).toBe(true);
    expect(segundo.body.dedupe_key).toBe(primeiro.body.dedupe_key);

    // A compra do `beforeEach` criou um ativo novo, e isso já pediu o backfill
    // dele — que também é da fila de mercado. A conta é pela chave da coleta.
    const [total] = await harness.sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total
        FROM pipeline_outbox
       WHERE dedupe_key = ${primeiro.body.dedupe_key as string}
    `;
    expect(Number(total?.total)).toBe(1);
  });

  it('com ativo, o pedido é o backfill daquele papel', async () => {
    const response = await request(harness.app)
      .post('/api/market/refresh')
      .send({ asset_id: ativo });

    expect(response.status).toBe(202);
    expect(response.body.dedupe_key).toBe(`backfill:${ativo}`);
  });

  it('ativo que não é uuid é recusado pelo contrato', async () => {
    const response = await request(harness.app)
      .post('/api/market/refresh')
      .send({ asset_id: 'nao-e-uuid' });

    expect(response.status).toBe(400);
    expect(response.body.issues[0].path).toBe('body.asset_id');
  });
});

describe('a série de preço do ativo', () => {
  it('devolve a série negociada e a ajustada, e valida contra o contrato', async () => {
    await gravarPreco('2026-10-01', '30.00');
    await gravarPreco('2026-10-02', '31.00');

    const response = await request(harness.app).get(`/api/assets/${ativo}/prices`);

    expect(response.status).toBe(200);
    expect(() => assetPriceSeriesSchema.parse(response.body)).not.toThrow();
    expect(response.body.points).toHaveLength(2);
    expect(response.body.adjusted).toBe(false);
  });

  it('evento confirmado ajusta o passado e deixa o preço de hoje intacto', async () => {
    await gravarPreco('2026-10-01', '60.00');
    await gravarPreco('2026-10-06', '30.00');

    const evento = await request(harness.app).post('/api/corporate-events').send({
      asset_id: ativo,
      kind: 'split',
      record_date: '2026-10-05',
      ratio_from: '1',
      ratio_to: '2',
    });

    await request(harness.app)
      .post(`/api/corporate-events/${evento.body.event.id}/confirm`)
      .send({});

    const { body } = await request(harness.app).get(`/api/assets/${ativo}/prices`);

    expect(body.adjusted).toBe(true);
    expect(body.points[0]).toMatchObject({
      close: '60.00000000',
      adjusted_close: '30.00000000',
    });
    // O preço de hoje é o preço real: ele não é ajustado.
    expect(body.points.at(-1)).toMatchObject({
      close: '30.00000000',
      adjusted_close: '30.00000000',
    });
  });

  it('evento ainda não confirmado não ajusta a série', async () => {
    await gravarPreco('2026-10-01', '60.00');

    await request(harness.app).post('/api/corporate-events').send({
      asset_id: ativo,
      kind: 'split',
      record_date: '2026-10-05',
      ratio_from: '1',
      ratio_to: '2',
    });

    const { body } = await request(harness.app).get(`/api/assets/${ativo}/prices`);

    expect(body.adjusted).toBe(false);
    expect(body.points[0].adjusted_close).toBe('60.00000000');
  });

  it('o intervalo pedido recorta a série', async () => {
    await gravarPreco('2026-10-01', '30.00');
    await gravarPreco('2026-10-02', '31.00');
    await gravarPreco('2026-10-05', '32.00');

    const { body } = await request(harness.app).get(
      `/api/assets/${ativo}/prices?from=2026-10-02&to=2026-10-02`,
    );

    expect(body.points.map((point: { price_date: string }) => point.price_date)).toEqual([
      '2026-10-02',
    ]);
  });

  it('ativo que não existe devolve 404', async () => {
    const response = await request(harness.app).get(
      '/api/assets/0191e5a0-0000-7000-8000-0000000000ff/prices',
    );

    expect(response.status).toBe(404);
  });

  it('ativo sem preço nenhum devolve série vazia, não erro', async () => {
    const { body } = await request(harness.app).get(`/api/assets/${ativo}/prices`);

    expect(body.points).toEqual([]);
    expect(body.adjusted).toBe(false);
  });
});
