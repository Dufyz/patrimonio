import { Queue } from 'bullmq';
import type { JobsOptions } from 'bullmq';

import type { OutboxEvent, Stage } from '@patrimonio/domain';

import type { RedisConnection } from './connection.js';
import { ALL_QUEUES, QUEUES, SCHEDULE_TIMEZONE } from './queues.js';

export type Queues = Record<Stage, Queue>;

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 30 * 24 * 60 * 60 },
};

export const createQueues = (connection: RedisConnection): Queues => {
  const entries = ALL_QUEUES.map((declaration) => [
    declaration.name,
    new Queue(declaration.name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
  ]);

  return Object.fromEntries(entries) as Queues;
};

export type DispatchResult = { readonly dispatched: readonly string[] };

/**
 * Entrega ao BullMQ os eventos que o relay reservou. O `jobId` é o id do evento
 * na outbox, e é isso que torna o despacho idempotente: reiniciar o relay no
 * meio não duplica job.
 */
export const dispatch = async (
  queues: Queues,
  events: readonly OutboxEvent[],
): Promise<DispatchResult> => {
  if (events.length === 0) return { dispatched: [] };

  const byStage = new Map<Stage, OutboxEvent[]>();

  for (const event of events) {
    const group = byStage.get(event.stage) ?? [];
    group.push(event);
    byStage.set(event.stage, group);
  }

  const dispatched: string[] = [];

  for (const [stage, group] of byStage) {
    await queues[stage].addBulk(
      group.map((event) => ({
        name: stage,
        data: {
          event_id: event.id,
          // Viaja com o job: um recálculo disparado por uma edição carrega o
          // requestId de origem até a última linha de log.
          origin_request_id: event.origin_request_id,
          ...event.payload,
        },
        opts: { jobId: event.id },
      })),
    );

    dispatched.push(...group.map((event) => event.id));
  }

  return { dispatched };
};

/**
 * Registra os jobs repetíveis. Eles não executam o estágio: inserem o evento na
 * outbox, e o relay despacha — por isso o agendamento não some num FLUSHALL.
 */
export const registerSchedules = async (queues: Queues): Promise<string[]> => {
  const registered: string[] = [];

  for (const declaration of ALL_QUEUES) {
    if (declaration.schedule === undefined) continue;

    for (const [index, pattern] of declaration.schedule.entries()) {
      const id = `${declaration.name}:schedule:${index}`;

      await queues[declaration.name].upsertJobScheduler(
        id,
        { pattern, tz: SCHEDULE_TIMEZONE },
        { name: declaration.name, data: { source: 'schedule' } },
      );

      registered.push(id);
    }
  }

  return registered;
};

export const closeQueues = async (queues: Queues): Promise<void> => {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
};

export { QUEUES, ALL_QUEUES, SCHEDULE_TIMEZONE };
