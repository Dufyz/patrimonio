import type { UnitOfWork } from '@patrimonio/application';
import { dispatch } from '@patrimonio/queue';
import type { Queues } from '@patrimonio/queue';
import { success } from '@patrimonio/shared';
import type { Logger } from 'pino';

export type RelayDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly queues: Queues;
  readonly logger: Logger;
  readonly pollMs: number;
  readonly batchSize: number;
};

export type RelayRun = { readonly dispatched: number };

/**
 * Uma passada do relay: lê pendentes com `FOR UPDATE SKIP LOCKED`, enfileira
 * com `addBulk` e marca `dispatched_at` na mesma transação do despacho.
 *
 * Se o `addBulk` passar e o commit falhar, os eventos voltam a ser pendentes e
 * o relay tenta de novo — e não duplica job, porque o `jobId` é o id do evento.
 * É por isso que o id da outbox e o do BullMQ são o mesmo.
 */
export const runRelayOnce = async (deps: RelayDeps): Promise<RelayRun> => {
  const result = await deps.unitOfWork.run(async (repositories) => {
    const claimed = await repositories.outbox.claimPending(deps.batchSize);
    if (claimed.isFailure()) return claimed;

    if (claimed.value.length === 0) return success(0);

    const { dispatched } = await dispatch(deps.queues, claimed.value);
    const marked = await repositories.outbox.markDispatched(dispatched);
    if (marked.isFailure()) return marked;

    return success(dispatched.length);
  });

  if (result.isFailure()) {
    deps.logger.error({ err: result.value.message }, 'relay falhou nesta passada');
    return { dispatched: 0 };
  }

  if (result.value > 0) {
    deps.logger.info({ dispatched: result.value }, 'eventos despachados');
  }

  return { dispatched: result.value };
};

export type Relay = { readonly stop: () => void };

/** O laço. Um `setTimeout` encadeado, não `setInterval`: duas passadas nunca se sobrepõem. */
export const startRelay = (deps: RelayDeps): Relay => {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) return;

    try {
      await runRelayOnce(deps);
    } catch (error) {
      deps.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'relay estourou',
      );
    }

    if (!stopped) {
      timer = setTimeout(() => void tick(), deps.pollMs);
      timer.unref();
    }
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
};
