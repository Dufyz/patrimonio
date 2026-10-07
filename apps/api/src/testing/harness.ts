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
import type { Express } from 'express';

import { createApp } from '../app.js';
import { createApiUseCases } from '../container.js';

/**
 * Supertest sobre a app Express completa, com banco e fila reais: nenhum mock.
 * Mock de repositório prova que o código chama o método certo, não que a
 * consulta devolve o número certo — e é a consulta que erra.
 */
export type ApiHarness = {
  readonly app: Express;
  readonly sql: Sql;
  readonly redis: RedisConnection;
  readonly queues: Queues;
  readonly close: () => Promise<void>;
};

export const createApiHarness = async (): Promise<ApiHarness> => {
  await runMigrations(environment.database.connection);

  const sql = createConnection({
    connection: environment.database.connection,
    poolSize: 4,
    applicationName: 'patrimonio-api-test',
  });
  const redis = createRedisConnection(environment.redis.url);
  const queues = createQueues(redis);
  const repositories = createRepositories(sql);
  const unitOfWork = createUnitOfWork(sql);

  const app = createApp({
    sql,
    redis,
    outbox: repositories.outbox,
    usecases: createApiUseCases({ unitOfWork, repositories }),
    queues,
    startedAt: new Date(),
    version: '0.1.0-test',
  });

  return {
    app,
    sql,
    redis,
    queues,
    close: async () => {
      await closeQueues(queues);
      await closeRedisConnection(redis);
      await closeDatabase(sql);
    },
  };
};

/**
 * O teste de rota atravessa o HTTP e comita: não há transação para desfazer no
 * fim. Então cada teste começa com as tabelas de fonte limpas — o calendário de
 * dias úteis fica, porque é semente e não dado de teste.
 */
export const resetSourceTables = async (sql: Sql): Promise<void> => {
  await sql.unsafe(`
    truncate table transaction,
                   strategy_target,
                   goal_portfolio,
                   goal,
                   manual_price,
                   asset,
                   category,
                   institution,
                   portfolio,
                   pipeline_outbox
      restart identity cascade
  `);
};

/** Uma categoria de topo, que é o que o alvo de alocação referencia. */
export const seedCategory = async (
  sql: Sql,
  name: string,
  colorToken = 'class.stock',
): Promise<string> => {
  const rows = await sql<{ id: string }[]>`
    insert into category (id, name, color_token)
    values (gen_random_uuid(), ${name}, ${colorToken})
    returning id
  `;

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('categoria de teste não foi criada');
  return id;
};

export const seedInstitution = async (
  sql: Sql,
  name: string,
  options: { readonly brokerage?: string; readonly fgc?: boolean } = {},
): Promise<string> => {
  const rows = await sql<{ id: string }[]>`
    insert into institution (id, name, role, fgc_covered, brokerage_per_order)
    values (
      gen_random_uuid(),
      ${name},
      'both',
      ${options.fgc ?? true},
      ${options.brokerage ?? '0'}
    )
    returning id
  `;

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('instituição de teste não foi criada');
  return id;
};
