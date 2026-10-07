import type { DateOnly, OutboxEvent, OutboxEventDraft, Stage } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * `already_queued` é verdadeiro quando outro pedido pendente com a mesma
 * `dedupe_key` absorveu este. As rotas que pedem trabalho ao pipeline
 * respondem 202 com esse par.
 */
export type EnqueuedEvent = {
  readonly id: string;
  readonly dedupe_key: string;
  readonly already_queued: boolean;
};

export type StageExecution = {
  readonly stage: Stage;
  readonly completed_at: string;
  readonly reference_date: DateOnly | null;
};

export type OutboxRepository = {
  /**
   * Grava os eventos na mesma transação do estado que os origina. Dois eventos
   * pendentes com a mesma chave viram um, e um recálculo pedido para uma data
   * mais antiga recua o `from_date` do evento que já estava lá.
   */
  readonly enqueue: (
    events: readonly OutboxEventDraft[],
  ) => Promise<Either<AppError, EnqueuedEvent[]>>;

  /**
   * Lê pendentes com `FOR UPDATE SKIP LOCKED`: dois relays em paralelo não
   * despacham o mesmo evento. Precisa rodar dentro de transação.
   */
  readonly claimPending: (limit: number) => Promise<Either<AppError, OutboxEvent[]>>;

  /** Marcado na mesma transação do despacho ao BullMQ. */
  readonly markDispatched: (ids: readonly string[]) => Promise<Either<AppError, number>>;

  readonly markStarted: (id: string) => Promise<Either<AppError, void>>;

  readonly markCompleted: (id: string) => Promise<Either<AppError, void>>;

  /** A falha final do estágio, gravada no registro do escopo. */
  readonly markFailed: (
    id: string,
    error: string,
    recoverable: boolean,
  ) => Promise<Either<AppError, void>>;

  readonly findById: (id: string) => Promise<Either<AppError, OutboxEvent | null>>;

  /** O que o healthcheck profundo reporta: a data do último fechamento concluído. */
  readonly lastCompletedExecution: (
    stage: Stage,
  ) => Promise<Either<AppError, StageExecution | null>>;
};
