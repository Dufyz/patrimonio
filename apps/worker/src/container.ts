import {
  backfillAsset,
  closeDay,
  collectMarketData,
  createDebouncePolicy,
  recalculatePortfolio,
  reconcileAlerts,
} from '@patrimonio/application';
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
import { createMarketSources } from './infra/market.js';

/**
 * O container do worker monta as mesmas dependências que o da api, com as
 * mesmas implementações — a regra de negócio não se duplica, os dois chamam os
 * mesmos casos de uso. O que difere é o tamanho do pool e o fato de este falar
 * com o Redis.
 */
export type WorkerUseCases = {
  readonly recalculatePortfolio: ReturnType<typeof recalculatePortfolio>;
  readonly closeDay: ReturnType<typeof closeDay>;
  readonly reconcileAlerts: ReturnType<typeof reconcileAlerts>;
  readonly collectMarketData: ReturnType<typeof collectMarketData>;
  readonly backfillAsset: ReturnType<typeof backfillAsset>;
};

export type WorkerContainer = {
  readonly sql: Sql;
  readonly redis: RedisConnection;
  readonly queues: Queues;
  readonly repositories: TransactionalRepositories;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly usecases: WorkerUseCases;
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

  // A coalescência é política de pipeline: a espera e o teto vêm de `env`, e a
  // regra de quais estágios esperam vem de `application`.
  const debounce = createDebouncePolicy(
    {
      waitMs: Math.min(environment.pipeline.relayPollMs * 2, environment.pipeline.debounceMaxMs),
      maxMs: environment.pipeline.debounceMaxMs,
    },
    () => systemClock.now(),
  );

  const unitOfWork = createUnitOfWork(sql, { debounce });

  // As fontes externas, montadas num lugar só. Nenhum caso de uso conhece o
  // nome de um provedor: ele recebe a cadeia pronta.
  const market = createMarketSources();

  return {
    sql,
    redis,
    queues,
    repositories: createRepositories(sql, { debounce }),
    unitOfWork,
    clock: systemClock,
    usecases: {
      recalculatePortfolio: recalculatePortfolio({ unitOfWork, clock: systemClock }),
      closeDay: closeDay({ unitOfWork, clock: systemClock }),
      // Os executores das treze regras entram em E7: sem eles a reconciliação
      // roda e não encontra nada, em vez de apagar o que já existe.
      reconcileAlerts: reconcileAlerts({ unitOfWork, clock: systemClock }),
      collectMarketData: collectMarketData({
        unitOfWork,
        clock: systemClock,
        quotes: market.quotes,
        indices: market.indices,
        treasury: market.treasury,
        staleAfterDays: environment.market.priceStaleAfterDays,
      }),
      backfillAsset: backfillAsset({
        unitOfWork,
        clock: systemClock,
        quotes: market.quotes,
      }),
    },
    shutdown: async () => {
      await closeQueues(queues);
      await closeRedisConnection(redis);
      await closeDatabase(sql);
      logger.info('worker encerrado');
    },
  };
};
