import type {
  AppError,
  Clock,
  OutboxRepository,
  UnitOfWork,
} from '@patrimonio/application';
import { isAppError } from '@patrimonio/application';
import { dedupeKey, transition } from '@patrimonio/domain';
import type { OutboxEventDraft, Stage, StageResult } from '@patrimonio/domain';
import { QUEUES } from '@patrimonio/queue';
import type { RedisConnection } from '@patrimonio/queue';
import type { Either } from '@patrimonio/shared';
import { UnrecoverableError, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';

export type StageJobData = {
  readonly event_id?: string;
  readonly origin_request_id?: string | null;
  /** Posto pelo job repetível do BullMQ: ele só insere o evento na outbox. */
  readonly source?: 'schedule';
  readonly [key: string]: unknown;
};

export type StageDeps = {
  readonly connection: RedisConnection;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxRepository;
  readonly clock: Clock;
  readonly logger: Logger;
};

export type StageDefinition<T> = {
  readonly stage: Stage;
  /** O caso de uso. Devolve `Either`, nunca lança. */
  readonly run: (job: Job<StageJobData>) => Promise<Either<AppError, T>>;
  /**
   * O evento que o agendamento insere na outbox, quando o estágio tem job
   * repetível. Sem isso, um estágio agendado não teria o que pedir.
   */
  readonly scheduledEvent?: (deps: StageDeps) => OutboxEventDraft;
};

/**
 * O comportamento comum a toda fila, declarado uma vez: log de início e fim com
 * `duration_ms` e `wait_ms`, tradução do erro do caso de uso em erro do BullMQ,
 * gravação da falha final e a concorrência vinda da declaração da fila.
 */
export const defineStage = <T>(
  definition: StageDefinition<T>,
  deps: StageDeps,
): Worker<StageJobData> => {
  const declaration = QUEUES[definition.stage];

  const worker = new Worker<StageJobData>(
    declaration.name,
    async (job) => {
      const startedAt = Date.now();
      const waitMs = Math.max(0, startedAt - job.timestamp);
      const log = deps.logger.child({
        stage: definition.stage,
        job_id: job.id,
        requestId: job.data.origin_request_id ?? undefined,
      });

      // Job repetível: não executa o estágio, insere o pedido na outbox. O
      // relay despacha, e assim o histórico de execução fica no Postgres.
      if (job.data.source === 'schedule') {
        const draft = definition.scheduledEvent?.(deps);

        if (draft === undefined) {
          log.warn('estágio agendado sem evento declarado: nada a inserir');
          return;
        }

        const enqueued = await deps.outbox.enqueue([draft]);

        if (enqueued.isFailure()) {
          log.error({ err: enqueued.value.message }, 'agendamento não virou evento');
          throw new Error(enqueued.value.message);
        }

        log.info(
          {
            dedupe_key: draft.dedupe_key,
            already_queued: enqueued.value[0]?.already_queued,
          },
          'agendamento inserido na outbox',
        );
        return;
      }

      const eventId = job.data.event_id;
      if (eventId !== undefined) await deps.outbox.markStarted(eventId);

      log.info({ wait_ms: waitMs }, 'estágio começou');

      const result = await definition.run(job);
      const durationMs = Date.now() - startedAt;

      if (result.isFailure()) {
        const error = result.value;
        // 4xx é falha definitiva — reexecutar não muda o resultado. 5xx é
        // transitória: um provedor fora do ar merece outra tentativa.
        const recoverable = error.isTransient;
        const outcome: StageResult = {
          stage: definition.stage,
          outcome: 'failed',
          recoverable,
        };

        if (eventId !== undefined) {
          await deps.outbox.markFailed(eventId, error.message, recoverable);
        }

        log.error(
          {
            duration_ms: durationMs,
            wait_ms: waitMs,
            outcome: 'failed',
            recoverable,
            status_code: error.statusCode,
            next: transition(outcome).next,
            err: error.message,
          },
          'estágio falhou',
        );

        if (!recoverable) throw new UnrecoverableError(error.message);
        throw new Error(error.message);
      }

      if (eventId !== undefined) await deps.outbox.markCompleted(eventId);

      const next = transition({ stage: definition.stage, outcome: 'succeeded' }).next;

      log.info(
        { duration_ms: durationMs, wait_ms: waitMs, outcome: 'succeeded', next },
        'estágio terminou',
      );

      return result.value;
    },
    { connection: deps.connection, concurrency: declaration.concurrency },
  );

  worker.on('failed', (job, error) => {
    // A falha final, depois de esgotadas as tentativas.
    if (job === undefined || job.attemptsMade < (job.opts.attempts ?? 1)) return;

    deps.logger.error(
      {
        stage: definition.stage,
        job_id: job.id,
        attempts: job.attemptsMade,
        err: error.message,
      },
      'estágio falhou em definitivo',
    );
  });

  return worker;
};

/** Traduz um erro desconhecido do estágio num `AppError`, para o log e o retry. */
export const toAppError = (error: unknown, fallback: AppError): AppError =>
  isAppError(error) ? error : fallback;

export { dedupeKey };
