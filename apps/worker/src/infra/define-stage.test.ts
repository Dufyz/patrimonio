import {
  MarketDataUnavailableError,
  NotFoundError,
  closeDay,
  recalculatePortfolio,
  reconcileAlerts,
} from '@patrimonio/application';
import type { Clock, UnitOfWork } from '@patrimonio/application';
import {
  closeDatabase,
  createConnection,
  createRepositories,
  createUnitOfWork,
  runMigrations,
} from '@patrimonio/db';
import type { Sql } from '@patrimonio/db';
import { dedupeKey } from '@patrimonio/domain';
import { environment } from '@patrimonio/env';
import {
  closeQueues,
  closeRedisConnection,
  createQueues,
  createRedisConnection,
} from '@patrimonio/queue';
import type { Queues, RedisConnection } from '@patrimonio/queue';
import { failure, success } from '@patrimonio/shared';
import { unwrapSuccess } from '@patrimonio/shared/testing';
import { pino } from 'pino';
import type { Logger } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { defineStage } from './define-stage.js';
import type { StageDeps, StageUseCases } from './define-stage.js';

/**
 * Os casos de uso que `StageDeps` exige, montados sobre a mesma unidade de
 * trabalho do teste. Não são dublês: são os casos de uso de verdade, porque o que
 * este teste mede é o caminho do pipeline, não o cálculo.
 */
const stageUseCases = (unitOfWork: UnitOfWork, clock: Clock): StageUseCases => ({
  recalculatePortfolio: recalculatePortfolio({ unitOfWork, clock }),
  closeDay: closeDay({ unitOfWork, clock }),
  reconcileAlerts: reconcileAlerts({ unitOfWork, clock }),
});


let sql: Sql;
let redis: RedisConnection;
let queues: Queues;
let lines: Record<string, unknown>[];
let logger: Logger;
let deps: StageDeps;

const clock = {
  now: () => new Date('2026-10-06T12:00:00.000Z'),
  today: () => '2026-10-06',
};

beforeAll(async () => {
  await runMigrations(environment.database.connection);

  sql = createConnection({
    connection: environment.database.connection,
    poolSize: 4,
    applicationName: 'patrimonio-stage-test',
  });
  redis = createRedisConnection(environment.redis.url);
  queues = createQueues(redis);
});

afterAll(async () => {
  await closeQueues(queues);
  await closeRedisConnection(redis);
  await closeDatabase(sql);
});

beforeEach(() => {
  lines = [];
  logger = pino(
    { level: 'debug' },
    {
      write: (line: string) => {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );

  const unitOfWork = createUnitOfWork(sql);

  deps = {
    connection: redis,
    unitOfWork,
    outbox: createRepositories(sql).outbox,
    clock,
    logger,
    usecases: stageUseCases(unitOfWork, clock),
  };
});

afterEach(async () => {
  await sql`delete from pipeline_outbox`;
  await queues.import.obliterate({ force: true });
  await queues.market.obliterate({ force: true });
});

const enqueueEvent = async (stage: 'import' | 'market') =>
  unwrapSuccess(
    await createRepositories(sql).outbox.enqueue([
      {
        stage,
        dedupe_key:
          stage === 'import'
            ? dedupeKey.import('planilha-1')
            : dedupeKey.market('2026-10-06'),
        payload:
          stage === 'import'
            ? { import_id: 'planilha-1' }
            : { reference_date: '2026-10-06' },
        origin_request_id: 'request-de-origem',
      },
    ]),
  );

const waitFor = async (condition: () => Promise<boolean>, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('a condição não aconteceu no tempo esperado');
};

const rowOf = async (id: string) => {
  const [row] = await sql<
    {
      started_at: Date | null;
      completed_at: Date | null;
      failed_at: Date | null;
      attempts: number;
      error: string | null;
    }[]
  >`
    select started_at, completed_at, failed_at, attempts, error
      from pipeline_outbox where id = ${id}
  `;

  return row;
};

describe('defineStage', () => {
  it('a concorrência vem da declaração da fila, não do processor', () => {
    const worker = defineStage({ stage: 'market', run: async () => success(null) }, deps);

    expect(worker.opts.concurrency).toBe(2);

    void worker.close();
  });

  it('registra início e fim com duration_ms e wait_ms', async () => {
    const [event] = await enqueueEvent('import');
    await queues.import.add(
      'import',
      { event_id: event!.id, import_id: 'planilha-1' },
      {
        jobId: event!.id,
      },
    );

    const worker = defineStage(
      { stage: 'import', run: async () => success('feito') },
      deps,
    );

    try {
      await waitFor(async () => (await rowOf(event!.id))?.completed_at !== null);

      const finished = lines.find((line) => line['msg'] === 'estágio terminou');

      expect(finished).toMatchObject({ stage: 'import', outcome: 'succeeded' });
      expect(finished?.['duration_ms']).toBeTypeOf('number');
      expect(finished?.['wait_ms']).toBeTypeOf('number');
    } finally {
      await worker.close();
    }
  });

  it('o requestId de origem acompanha o job até a última linha de log', async () => {
    const [event] = await enqueueEvent('import');
    await queues.import.add(
      'import',
      {
        event_id: event!.id,
        origin_request_id: 'request-de-origem',
        import_id: 'planilha-1',
      },
      { jobId: event!.id },
    );

    const worker = defineStage({ stage: 'import', run: async () => success(null) }, deps);

    try {
      await waitFor(async () => (await rowOf(event!.id))?.completed_at !== null);

      expect(lines.some((line) => line['requestId'] === 'request-de-origem')).toBe(true);
    } finally {
      await worker.close();
    }
  });

  it('erro 4xx do caso de uso é falha definitiva: não reexecuta', async () => {
    const [event] = await enqueueEvent('import');
    await queues.import.add(
      'import',
      { event_id: event!.id, import_id: 'planilha-1' },
      { jobId: event!.id, attempts: 5, backoff: { type: 'fixed', delay: 10 } },
    );

    const worker = defineStage(
      {
        stage: 'import',
        run: async () => failure(new NotFoundError('carteira inexistente')),
      },
      deps,
    );

    try {
      await waitFor(async () => (await rowOf(event!.id))?.failed_at !== null);

      const row = await rowOf(event!.id);
      expect(row?.error).toBe('carteira inexistente');
      expect(row?.attempts).toBe(1);

      // Uma tentativa só, mesmo com attempts: 5 declarado no job.
      const job = await queues.import.getJob(event!.id);
      expect(job?.attemptsMade).toBe(1);
      expect(await job?.isFailed()).toBe(true);
    } finally {
      await worker.close();
    }
  });

  it('erro 5xx é transitório: reexecuta e não marca failed_at', async () => {
    const [event] = await enqueueEvent('market');
    await queues.market.add(
      'market',
      { event_id: event!.id, reference_date: '2026-10-06' },
      { jobId: event!.id, attempts: 3, backoff: { type: 'fixed', delay: 10 } },
    );

    const worker = defineStage(
      {
        stage: 'market',
        run: async () => failure(new MarketDataUnavailableError('provedor fora do ar')),
      },
      deps,
    );

    try {
      await waitFor(async () => ((await rowOf(event!.id))?.attempts ?? 0) >= 2);

      const row = await rowOf(event!.id);
      expect(row?.failed_at).toBeNull();
      expect(row?.error).toBe('provedor fora do ar');
      expect(row?.attempts).toBeGreaterThanOrEqual(2);
    } finally {
      await worker.close();
    }
  });

  it('job agendado não executa o estágio: insere o pedido na outbox', async () => {
    await queues.market.add('market', { source: 'schedule' });

    const worker = defineStage(
      {
        stage: 'market',
        run: async () => {
          throw new Error('o estágio não deveria rodar num job agendado');
        },
        scheduledEvent: (stageDeps) => ({
          stage: 'market',
          dedupe_key: dedupeKey.market(stageDeps.clock.today()),
          payload: { reference_date: stageDeps.clock.today() },
        }),
      },
      deps,
    );

    try {
      await waitFor(async () => {
        const [row] = await sql<{ total: string }[]>`
          select count(*)::text as total
            from pipeline_outbox where dedupe_key = 'market:2026-10-06'
        `;
        return Number(row?.total) === 1;
      });

      const [row] = await sql<{ payload: { reference_date: string } }[]>`
        select payload from pipeline_outbox where dedupe_key = 'market:2026-10-06'
      `;

      expect(row?.payload.reference_date).toBe('2026-10-06');
    } finally {
      await worker.close();
    }
  });
});
