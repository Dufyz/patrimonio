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
import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { closeStage } from '../processors/close.stage.js';
import { stageUseCases } from '../testing/stage-usecases.js';
import { logger } from './logger.js';
import { runRelayOnce } from './relay.js';
import type { RelayDeps } from './relay.js';

let sql: Sql;
let redis: RedisConnection;
let queues: Queues;
let deps: RelayDeps;

const clock = { now: () => new Date(), today: () => '2026-10-06' };

beforeAll(async () => {
  await runMigrations(environment.database.connection);

  sql = createConnection({
    connection: environment.database.connection,
    poolSize: 4,
    applicationName: 'patrimonio-relay-test',
  });
  redis = createRedisConnection(environment.redis.url);
  queues = createQueues(redis);

  deps = {
    unitOfWork: createUnitOfWork(sql),
    queues,
    logger,
    pollMs: 50,
    batchSize: 10,
  };
});

afterAll(async () => {
  await closeQueues(queues);
  await closeRedisConnection(redis);
  await closeDatabase(sql);
});

afterEach(async () => {
  await sql`delete from pipeline_outbox`;
  await Promise.all(
    Object.values(queues).map((queue) => queue.obliterate({ force: true })),
  );
});

const enqueue = async (key: string) =>
  unwrapSuccess(
    await createRepositories(sql).outbox.enqueue([
      {
        stage: 'close',
        dedupe_key: key,
        payload: { reference_date: '2026-10-06' },
      },
    ]),
  );

const waitFor = async (
  condition: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('a condição não aconteceu no tempo esperado');
};

describe('relay', () => {
  it('evento pendente vira job, com dispatched_at marcado', async () => {
    const [event] = await enqueue(dedupeKey.close('2026-10-06'));

    const run = await runRelayOnce(deps);

    expect(run.dispatched).toBe(1);

    const job = await queues.close.getJob(event!.id);
    expect(job?.id).toBe(event!.id);
    expect(job?.data).toMatchObject({
      event_id: event!.id,
      reference_date: '2026-10-06',
    });

    const [row] = await sql<{ dispatched_at: Date | null }[]>`
      select dispatched_at from pipeline_outbox where id = ${event!.id}
    `;
    expect(row?.dispatched_at).not.toBeNull();
  });

  it('a segunda passada não despacha de novo o que já foi despachado', async () => {
    await enqueue(dedupeKey.close('2026-10-06'));

    expect((await runRelayOnce(deps)).dispatched).toBe(1);
    expect((await runRelayOnce(deps)).dispatched).toBe(0);

    expect(await queues.close.getJobCountByTypes('waiting', 'active', 'completed')).toBe(
      1,
    );
  });

  it('reiniciar o relay no meio não duplica job, porque o jobId é o id do evento', async () => {
    const [event] = await enqueue(dedupeKey.close('2026-10-06'));

    // Simula o despacho que chegou ao Redis e cujo commit não aconteceu:
    // o evento volta a ser pendente e o relay tenta de novo.
    await runRelayOnce(deps);
    await sql`update pipeline_outbox set dispatched_at = null where id = ${event!.id}`;

    await runRelayOnce(deps);

    const jobs = await queues.close.getJobs([
      'waiting',
      'active',
      'completed',
      'delayed',
    ]);
    expect(jobs.filter((job) => job.id === event!.id)).toHaveLength(1);
  });

  it('dois relays em paralelo não despacham o mesmo evento', async () => {
    await enqueue(dedupeKey.close('2026-10-06'));

    const [first, second] = await Promise.all([runRelayOnce(deps), runRelayOnce(deps)]);

    expect(first.dispatched + second.dispatched).toBe(1);
  });

  it('sem nada pendente a passada é silenciosa', async () => {
    expect((await runRelayOnce(deps)).dispatched).toBe(0);
  });
});

describe('critério de saída do épico', () => {
  it('um evento atravessa outbox → relay → fila → job até o fim', async () => {
    const [event] = await enqueue(dedupeKey.close('2026-10-06'));

    const worker = closeStage({
      connection: redis,
      unitOfWork: deps.unitOfWork,
      outbox: createRepositories(sql).outbox,
      clock,
      logger,
      usecases: stageUseCases(deps.unitOfWork, clock),
    });

    try {
      await runRelayOnce(deps);

      // O fim é o evento marcado como concluído no Postgres, não o job no Redis:
      // é o Postgres que responde "quando foi o último fechamento".
      await waitFor(async () => {
        const [row] = await sql<{ completed_at: Date | null; started_at: Date | null }[]>`
          select completed_at, started_at from pipeline_outbox where id = ${event!.id}
        `;
        return row?.completed_at !== null;
      });

      const [row] = await sql<
        { started_at: Date | null; completed_at: Date | null; attempts: number }[]
      >`
        select started_at, completed_at, attempts
          from pipeline_outbox where id = ${event!.id}
      `;

      expect(row?.started_at).not.toBeNull();
      expect(row?.completed_at).not.toBeNull();
      expect(row?.attempts).toBe(1);
    } finally {
      await worker.close();
    }
  });
});
