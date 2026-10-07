import type {
  Clock,
  TransactionalRepositories,
  UnitOfWork,
} from '@patrimonio/application';
import {
  closeDatabase,
  createConnection,
  createRepositories,
  createUnitOfWork,
} from '@patrimonio/db';
import type { Sql } from '@patrimonio/db';
import { toDateOnly } from '@patrimonio/domain';
import { environment } from '@patrimonio/env';
import {
  closeQueues,
  closeRedisConnection,
  createQueues,
  createRedisConnection,
} from '@patrimonio/queue';
import type { Queues, RedisConnection } from '@patrimonio/queue';

import { logger } from './infra/logger.js';

/**
 * O container do worker monta as mesmas dependências que o da api, com as
 * mesmas implementações — a regra de negócio não se duplica, os dois chamam os
 * mesmos casos de uso. O que difere é o tamanho do pool e o fato de este falar
 * com o Redis.
 */
export type WorkerContainer = {
  readonly sql: Sql;
  readonly redis: RedisConnection;
  readonly queues: Queues;
  readonly repositories: TransactionalRepositories;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly shutdown: () => Promise<void>;
};

export const systemClock: Clock = {
  now: () => new Date(),
  today: () => toDateOnly(new Date()),
};

export const createContainer = (): WorkerContainer => {
  const sql = createConnection({
    connection: environment.database.connection,
    poolSize: environment.database.poolWorker,
    applicationName: 'patrimonio-worker',
  });

  const redis = createRedisConnection(environment.redis.url);
  const queues = createQueues(redis);

  return {
    sql,
    redis,
    queues,
    repositories: createRepositories(sql),
    unitOfWork: createUnitOfWork(sql),
    clock: systemClock,
    shutdown: async () => {
      await closeQueues(queues);
      await closeRedisConnection(redis);
      await closeDatabase(sql);
      logger.info('worker encerrado');
    },
  };
};
