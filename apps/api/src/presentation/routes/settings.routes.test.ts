import { settingsSchema } from '@patrimonio/contracts';
import { requestBackup } from '@patrimonio/application';
import { createUnitOfWork } from '@patrimonio/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { systemClock } from '../../infra/config/clock.js';
import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * A tela de Configurações, pela rota, contra Postgres de verdade. O que está sob
 * teste é a leitura inteira — banco, caso de uso, contrato — e o que a tela não
 * pode inventar: bloqueio de exclusão sem contagem, barra de FGC para quem não
 * emite, e botão de backup que promete um arquivo que não vai existir.
 */
let harness: ApiHarness;

const configuracoes = () => request(harness.app).get('/api/settings');

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);
});

describe('GET /api/settings', () => {
  it('sem cadastro nenhum responde as seções vazias, dentro do contrato', async () => {
    const response = await configuracoes();

    expect(response.status).toBe(200);
    expect(() => settingsSchema.parse(response.body)).not.toThrow();
    expect(response.body.portfolios).toEqual([]);
    expect(response.body.archived_portfolios).toEqual([]);
    expect(response.body.categories).toEqual([]);
    expect(response.body.institutions).toEqual([]);
  });

  it('os benchmarks de referência e as regras de mercado vêm semeados', async () => {
    const response = await configuracoes();

    expect(
      response.body.benchmarks.map((benchmark: { name: string }) => benchmark.name),
    ).toEqual(expect.arrayContaining(['CDI', 'IPCA', 'Ibovespa']));
    expect(response.body.alerts.map((rule: { kind: string }) => rule.kind)).toEqual(
      expect.arrayContaining(['price_stale', 'price_missing']),
    );
  });

  it('o que é do ambiente chega como leitura, com a liquidação do domínio', async () => {
    const response = await configuracoes();

    expect(response.body.ledger_defaults).toEqual({
      undo_window_seconds: 8,
      jcp_withholding_pct: '15',
      settlement: [
        { label: 'Ações e FIIs', business_days: 2 },
        { label: 'Tesouro', business_days: 1 },
        { label: 'RF bancária', business_days: 0 },
      ],
      editable: false,
    });
  });

  it('o backup desligado na instalação chega como desligado', async () => {
    const response = await configuracoes();

    expect(response.body.backup).toEqual({
      enabled: false,
      last_success_at: null,
      last_failure: null,
      pending: false,
    });
  });

  it('só quem emite e é coberto pelo FGC tem exposição, e ela vem com o percentual do teto', async () => {
    const custodiante = await request(harness.app)
      .post('/api/institutions')
      .send({ name: 'Corretora A', role: 'custodian' });
    const emissor = await request(harness.app)
      .post('/api/institutions')
      .send({ name: 'Banco B', role: 'both', fgc_covered: true });
    const uniao = await request(harness.app)
      .post('/api/institutions')
      .send({ name: 'Tesouro Direto', role: 'issuer' });
    expect([custodiante.status, emissor.status, uniao.status]).toEqual([201, 201, 201]);

    const response = await configuracoes();
    const byName = new Map(
      response.body.institutions.map(
        (institution: { name: string }) => [institution.name, institution] as const,
      ),
    );

    expect(byName.get('Corretora A')).toMatchObject({ fgc: null });
    expect(byName.get('Tesouro Direto')).toMatchObject({ fgc: null });
    expect(byName.get('Banco B')).toMatchObject({
      fgc: { exposure: '0.00', limit: '250000.00', used_pct: '0.00', over_limit: false },
    });
  });

  it('a carteira arquivada sai da lista e a categoria renomeada continua a mesma', async () => {
    const criada = await request(harness.app)
      .post('/api/portfolios')
      .send({ name: 'Viagem 2024' });
    const arquivada = await request(harness.app)
      .post(`/api/portfolios/${criada.body.portfolio.id}/archive`)
      .send({ archived: true });
    expect(arquivada.status).toBe(200);
    const categoria = await request(harness.app)
      .post('/api/categories')
      .send({ name: 'Ações', color_token: 'class.acoes' });
    const id = categoria.body.category.id as string;

    const renomeada = await request(harness.app)
      .patch(`/api/categories/${id}`)
      .send({ name: 'Ações Brasil' });
    expect(renomeada.status).toBe(200);

    const response = await configuracoes();

    expect(response.body.portfolios).toEqual([]);
    expect(response.body.archived_portfolios).toHaveLength(1);
    expect(response.body.archived_portfolios[0].name).toBe('Viagem 2024');
    expect(response.body.categories).toHaveLength(1);
    expect(response.body.categories[0]).toMatchObject({ id, name: 'Ações Brasil' });
  });
});

describe('POST /api/backup', () => {
  it('com o backup desligado recusa e diz por quê, em vez de prometer um arquivo', async () => {
    const response = await request(harness.app).post('/api/backup').send({});

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('desligado');

    const [pedidos] = await harness.sql<{ total: string }[]>`
      select count(*)::text as total from pipeline_outbox where stage = 'backup'
    `;
    expect(pedidos?.total).toBe('0');
  });
});

describe('o pedido de backup com o backup ligado', () => {
  const pedir = () =>
    requestBackup({
      unitOfWork: createUnitOfWork(harness.sql),
      clock: systemClock,
      backupEnabled: true,
    })({});

  it('enfileira na outbox e a tela passa a ver o pedido pendente', async () => {
    const result = await pedir();

    expect(result.isSuccess()).toBe(true);
    const response = await configuracoes();
    expect(response.body.backup.pending).toBe(true);
  });

  it('dois pedidos seguidos viram um só', async () => {
    const primeiro = await pedir();
    const segundo = await pedir();

    expect(primeiro.isSuccess() && primeiro.value.queued.already_queued).toBe(false);
    expect(segundo.isSuccess() && segundo.value.queued.already_queued).toBe(true);

    const [pedidos] = await harness.sql<{ total: string }[]>`
      select count(*)::text as total from pipeline_outbox where stage = 'backup'
    `;
    expect(pedidos?.total).toBe('1');
  });
});
