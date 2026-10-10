import {
  closeDatabase,
  createConnection,
  createRepositories,
  createUnitOfWork,
  loadBusinessDays,
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
import { systemClock } from '../infra/config/clock.js';
import { createQueryCounter } from './query-counter.js';
import type { QueryCounter } from './query-counter.js';

const POOL_SIZE = 4;

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
  /** T-11 · conta as idas ao Postgres de um trecho: ver `query-counter.ts`. */
  readonly queryCounter: QueryCounter;
  readonly close: () => Promise<void>;
};

export const createApiHarness = async (): Promise<ApiHarness> => {
  await runMigrations(environment.database.connection);

  const queryCounter = createQueryCounter();
  const sql = createConnection({
    connection: environment.database.connection,
    poolSize: POOL_SIZE,
    applicationName: 'patrimonio-api-test',
    onQuery: queryCounter.record,
  });
  // A liquidação sugerida conta dia útil, então o calendário precisa existir
  // antes da primeira compra.
  const [calendar] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::TEXT AS total FROM business_day
  `;
  if (Number(calendar?.total ?? 0) === 0) await loadBusinessDays(sql);

  const redis = createRedisConnection(environment.redis.url);
  const queues = createQueues(redis);
  const repositories = createRepositories(sql);
  const unitOfWork = createUnitOfWork(sql);

  const app = createApp({
    sql,
    redis,
    outbox: repositories.outbox,
    usecases: createApiUseCases({ unitOfWork, repositories, clock: systemClock }),
    queues,
    startedAt: new Date(),
    version: '0.1.0-test',
  });

  return {
    app,
    sql,
    redis,
    queues,
    queryCounter,
    close: async () => {
      // A suíte comita, e o banco é compartilhado com a de `db`, cujos testes
      // rodam em transação e contam com as tabelas vazias. Devolver o banco como
      // foi encontrado é o que torna a ordem das suítes irrelevante.
      await resetSourceTables(sql);
      await closeQueues(queues);
      await closeRedisConnection(redis);
      await closeDatabase(sql);
    },
  };
};

/**
 * O teste de rota atravessa o HTTP e comita: não há transação para desfazer no
 * fim. Então cada teste começa com as tabelas de fonte e de projeção limpas — o
 * calendário de dias úteis fica, porque é semente e não dado de teste.
 */
export const resetSourceTables = async (sql: Sql): Promise<void> => {
  await sql.unsafe(`
    TRUNCATE TABLE position_daily,
                   portfolio_daily,
                   realized_result,
                   tax_month,
                   asset_price,
                   transaction,
                   transaction_undo,
                   payout_dismissal,
                   strategy_target,
                   goal,
                   manual_price,
                   asset,
                   category,
                   institution,
                   portfolio,
                   pipeline_outbox,
                   index_quote,
                   market_source_run
      restart IDENTITY CASCADE
  `);
};

/** Uma categoria de topo, que é o que o alvo de alocação referencia. */
export const seedCategory = async (
  sql: Sql,
  name: string,
  colorToken = 'class.stock',
): Promise<string> => {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO category (id, name, color_token)
    VALUES (GEN_RANDOM_UUID(), ${name}, ${colorToken})
    RETURNING id
  `;

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('categoria de teste não foi criada');
  return id;
};

export const seedInstitution = async (
  sql: Sql,
  name: string,
): Promise<string> => {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO institution (id, name)
    VALUES (GEN_RANDOM_UUID(), ${name})
    RETURNING id
  `;

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('instituição de teste não foi criada');
  return id;
};
