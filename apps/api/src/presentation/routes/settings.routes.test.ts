import { settingsSchema } from '@patrimonio/contracts';
import { requestBackup } from '@patrimonio/application';
import { createUnitOfWork, loadFinanceDemo } from '@patrimonio/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { systemClock } from '../../infra/config/clock.js';
import { createApiHarness, resetSourceTables } from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * A tela de Configurações, pela rota, contra Postgres de verdade. O que está sob
 * teste é a leitura inteira — banco, caso de uso, contrato — e o que a tela não
 * pode inventar: bloqueio de exclusão sem contagem, e botão de backup que promete um arquivo que não vai existir.
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
      files: [],
    });
  });

  it('a carteira arquivada sai da lista e aparece à parte', async () => {
    const criada = await request(harness.app)
      .post('/api/portfolios')
      .send({ name: 'Viagem 2024' });
    const arquivada = await request(harness.app)
      .post(`/api/portfolios/${criada.body.portfolio.id}/archive`)
      .send({ archived: true });
    expect(arquivada.status).toBe(200);

    const response = await configuracoes();

    expect(response.body.portfolios).toEqual([]);
    expect(response.body.archived_portfolios).toHaveLength(1);
    expect(response.body.archived_portfolios[0].name).toBe('Viagem 2024');
  });
});

describe('POST /api/backup', () => {
  it('com o backup desligado recusa e diz por quê, em vez de prometer um arquivo', async () => {
    const response = await request(harness.app).post('/api/backup').send({});

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('desligado');

    const [pedidos] = await harness.sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM pipeline_outbox WHERE stage = 'backup'
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
      SELECT COUNT(*)::TEXT AS total FROM pipeline_outbox WHERE stage = 'backup'
    `;
    expect(pedidos?.total).toBe('1');
  });
});

describe('POST /api/backup/restore (BKP-03)', () => {
  const body = {
    name: 'patrimonio-2026-11-12-s053.dump.age',
    identity: 'AGE-SECRET-KEY-1ABCDEFGHIJ',
    confirmation: 'RESTAURAR',
  };

  it('sem a palavra RESTAURAR a rota recusa antes de tocar em qualquer coisa', async () => {
    const response = await request(harness.app)
      .post('/api/backup/restore')
      .send({ ...body, confirmation: 'restaurar' });
    expect(response.status).toBe(400);
  });

  it('sem a chave a rota recusa', async () => {
    const response = await request(harness.app)
      .post('/api/backup/restore')
      .send({ ...body, identity: '' });
    expect(response.status).toBe(400);
  });

  it('com o backup desligado nesta instalação, diz que não há o que restaurar', async () => {
    const response = await request(harness.app).post('/api/backup/restore').send(body);
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/desligado|sem destino/);
  });
});

describe('exportar e apagar tudo (BKP-04)', () => {
  const tabelas = [
    'fin_category',
    'fin_account',
    'fin_card',
    'fin_recurring',
    'fin_entry',
    'fin_movement',
    'fin_card_item',
    'fin_invoice_payment',
  ] as const;

  const contar = async (tabela: string): Promise<number> => {
    const [linha] = await harness.sql.unsafe<{ total: number }[]>(
      `SELECT COUNT(*)::INTEGER AS total FROM ${tabela}`,
    );
    return linha?.total ?? 0;
  };

  it('o JSON traz a versão do esquema e as entidades de Finanças, com a contagem das tabelas', async () => {
    await loadFinanceDemo(harness.sql);
    await request(harness.app).post('/api/portfolios').send({ name: 'Longo prazo' });

    const response = await request(harness.app).get('/api/data/export');
    expect(response.status).toBe(200);
    const documento = JSON.parse(response.text) as {
      schema_version: string;
      tables: Record<string, unknown[]>;
    };

    expect(documento.schema_version).toMatch(/^\d{3}$/);
    for (const tabela of tabelas) {
      expect(documento.tables[tabela]).toBeDefined();
      expect(documento.tables[tabela]?.length).toBe(await contar(tabela));
    }
    expect(documento.tables['fin_entry']?.length).toBeGreaterThan(0);
    expect(documento.tables['portfolio']).toHaveLength(1);
  });

  it('apagar tudo exige a palavra APAGAR e deixa Finanças e carteiras vazias', async () => {
    await loadFinanceDemo(harness.sql);
    await request(harness.app).post('/api/portfolios').send({ name: 'Longo prazo' });

    const recusado = await request(harness.app)
      .delete('/api/data')
      .send({ confirmation: 'apagar' });
    expect(recusado.status).toBe(400);
    expect(await contar('fin_entry')).toBeGreaterThan(0);

    const apagado = await request(harness.app)
      .delete('/api/data')
      .send({ confirmation: 'APAGAR' });
    expect(apagado.status).toBe(200);
    for (const tabela of [...tabelas, 'portfolio']) {
      expect(await contar(tabela), tabela).toBe(0);
    }
  });
});
