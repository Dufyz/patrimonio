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
import { environment } from '@patrimonio/env';
import {
  closeQueues,
  closeRedisConnection,
  createQueues,
  createRedisConnection,
} from '@patrimonio/queue';
import type { Queues, RedisConnection } from '@patrimonio/queue';

import { systemClock } from './infra/config/clock.js';

/**
 * Monta repositórios, gateways e casos de uso uma vez, no boot. Nenhum
 * controller instancia dependência: ele recebe o caso de uso pronto, e trocar
 * uma implementação é mudar uma linha daqui.
 */
export type ApiContainer = {
  readonly sql: Sql;
  readonly redis: RedisConnection;
  readonly queues: Queues;
  readonly repositories: TransactionalRepositories;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly version: string;
  readonly startedAt: Date;
  readonly shutdown: () => Promise<void>;
};

export const createContainer = (version: string): ApiContainer => {
  const sql = createConnection({
    connection: environment.database.connection,
    // O pool da api e o do worker têm tamanhos diferentes: a api atende
    // request curto, o worker roda recálculo longo.
    poolSize: environment.database.poolApi,
    applicationName: 'patrimonio-api',
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
    version,
    startedAt: new Date(),
    shutdown: async () => {
      await closeQueues(queues);
      await closeRedisConnection(redis);
      await closeDatabase(sql);
    },
  };
};
