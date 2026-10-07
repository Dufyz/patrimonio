import { healthCheckResourceSchema, liveResourceSchema } from '@patrimonio/contracts';
import {
  closeDatabase,
  createConnection,
  createRepositories,
  createUnitOfWork,
  runMigrations,
} from '@patrimonio/db';
import type { Sql } from '@patrimonio/db';
import { environment } from '@patrimonio/env';
import {
  closeQueues,
  closeRedisConnection,
  createQueues,
  createRedisConnection,
} from '@patrimonio/queue';
import type { Queues, RedisConnection } from '@patrimonio/queue';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { createApiUseCases } from './container.js';
import { ROUTE_DOCS } from './presentation/docs/openapi.js';

let sql: Sql;
let redis: RedisConnection;
let queues: Queues;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  await runMigrations(environment.database.connection);

  sql = createConnection({
    connection: environment.database.connection,
    poolSize: 2,
    applicationName: 'patrimonio-api-test',
  });
  redis = createRedisConnection(environment.redis.url);
  queues = createQueues(redis);

  const repositories = createRepositories(sql);

  app = createApp({
    sql,
    redis,
    outbox: repositories.outbox,
    usecases: createApiUseCases({ unitOfWork: createUnitOfWork(sql), repositories }),
    queues,
    startedAt: new Date(),
    version: '0.1.0-test',
  });
});

afterAll(async () => {
  if (queues !== undefined) await closeQueues(queues);
  if (redis !== undefined) await closeRedisConnection(redis);
  if (sql !== undefined) await closeDatabase(sql);
});

describe('healthcheck', () => {
  it('a rota rasa responde que o processo está vivo', async () => {
    const response = await request(app).get('/api/health-check/live');

    expect(response.status).toBe(200);
    expect(liveResourceSchema.parse(response.body)).toEqual({ status: 'ok' });
  });

  it('a rota profunda verifica Postgres e Redis separadamente', async () => {
    const response = await request(app).get('/api/health-check');

    expect(response.status).toBe(200);

    const body = healthCheckResourceSchema.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.redis.ok).toBe(true);
  });

  it('a rota profunda reporta a data do último fechamento concluído', async () => {
    const response = await request(app).get('/api/health-check');
    const body = healthCheckResourceSchema.parse(response.body);

    // Sem nenhum fechamento ainda, o campo é nulo em vez de ausente.
    expect(body).toHaveProperty('last_daily_close');
    expect(body.last_daily_close).toBeNull();
  });

  it('com o banco fora do ar responde 503, não 200 com número velho', async () => {
    const brokenSql = createConnection({
      connection: 'postgres://patrimonio:patrimonio@localhost:1/patrimonio',
      poolSize: 1,
      applicationName: 'patrimonio-api-test-broken',
    });

    const brokenRepositories = createRepositories(brokenSql);

    const degraded = createApp({
      sql: brokenSql,
      redis,
      outbox: brokenRepositories.outbox,
      usecases: createApiUseCases({
        unitOfWork: createUnitOfWork(brokenSql),
        repositories: brokenRepositories,
      }),
      startedAt: new Date(),
      version: '0.1.0-test',
    });

    const response = await request(degraded).get('/api/health-check');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.database.ok).toBe(false);

    await brokenSql.end({ timeout: 1 }).catch(() => undefined);
  });
});

describe('middlewares', () => {
  it('todo request recebe um requestId, devolvido no cabeçalho', async () => {
    const response = await request(app).get('/api/health-check/live');

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('um requestId que chega de fora é preservado, para correlacionar', async () => {
    const response = await request(app)
      .get('/api/health-check/live')
      .set('X-Request-Id', 'request-de-fora');

    expect(response.headers['x-request-id']).toBe('request-de-fora');
  });

  it('rota inexistente responde 404 nomeando método e caminho', async () => {
    const response = await request(app).get('/api/carteiras-que-nao-existem');

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('GET');
    expect(response.body.message).toContain('/api/carteiras-que-nao-existem');
    expect(response.body.request_id).toBeTruthy();
  });

  it('o CORS aceita exatamente uma origem', async () => {
    const permitida = await request(app)
      .get('/api/health-check/live')
      .set('Origin', environment.server.webOrigin);

    const outra = await request(app)
      .get('/api/health-check/live')
      .set('Origin', 'https://site-qualquer.com');

    expect(permitida.headers['access-control-allow-origin']).toBe(
      environment.server.webOrigin,
    );
    expect(permitida.headers['access-control-allow-credentials']).toBe('true');
    expect(outra.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('o helmet responde com os cabeçalhos de segurança e sem x-powered-by', async () => {
    const response = await request(app).get('/api/health-check/live');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['content-security-policy']).toBeTruthy();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('documentação', () => {
  it('serve o documento OpenAPI e a interface', async () => {
    const document = await request(app).get('/api/docs.json');

    expect(document.status).toBe(200);
    expect(document.body.openapi).toBe('3.1.0');
    expect(document.body.paths).toHaveProperty('/api/health-check');
    expect(document.body.paths).toHaveProperty('/api/health-check/live');

    const ui = await request(app).get('/api/docs/');
    expect(ui.status).toBe(200);
  });

  it('cada resposta documentada carrega a razão do código', async () => {
    const { body } = await request(app).get('/api/docs.json');
    const deep = body.paths['/api/health-check'].get;

    expect(Object.keys(deep.responses)).toEqual(['200', '503']);
    expect(deep.responses['503'].description).toMatch(/não respondeu/);
  });

  it('rota sem entrada no registro não aparece na documentação', async () => {
    const { body } = await request(app).get('/api/docs.json');

    expect(Object.keys(body.paths)).toHaveLength(ROUTE_DOCS.length);
    expect(body.paths).not.toHaveProperty('/api/queues');
  });

  it('toda rota montada no Express tem entrada no registro', () => {
    const mounted = new Set<string>();

    type Layer = {
      route?: { path: string; methods?: Record<string, boolean> };
      handle?: { stack?: Layer[] };
      name?: string;
    };

    const walk = (layers: readonly Layer[]): void => {
      for (const layer of layers) {
        if (layer.route !== undefined) {
          for (const method of Object.keys(layer.route.methods ?? {})) {
            mounted.add(`${method} ${layer.route.path}`);
          }
        }

        if (layer.handle?.stack !== undefined) walk(layer.handle.stack);
      }
    };

    walk((app.router as unknown as { stack: Layer[] }).stack);

    // A documentação e o Bull Board são routers de terceiro, fora do contrato.
    const ours = [...mounted].filter(
      (entry) => !entry.includes('/docs') && !entry.includes('/queues'),
    );
    const registered = ROUTE_DOCS.map((route) => `${route.method} ${route.path}`);

    expect(ours.sort()).toEqual(registered.sort());
  });
});
