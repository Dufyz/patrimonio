import { moneyDifference } from '@patrimonio/calc';
import { dedupeKey } from '@patrimonio/domain';
import type { Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError, ConflictError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { portfolioLock } from './createTransaction.usecase.js';

export type ConfirmPayoutInput = {
  /** O líquido que de fato caiu na conta, quando diferente do previsto. */
  readonly net_amount?: string | undefined;
  readonly note?: string | undefined;
  readonly origin_request_id?: string | undefined;
};

export type ConfirmPayoutResult = {
  readonly transaction: Transaction;
  /** O previsto, guardado quando o recebido veio diferente. */
  readonly expected_net_amount: string | null;
  readonly difference: string | null;
  readonly queued: EnqueuedEvent | null;
};

export type ConfirmPayoutDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
};

/**
 * O provento previsto vira recebido quando o dinheiro entra. O valor pode
 * chegar diferente — imposto a mais, arredondamento da corretora, anúncio
 * revisado — e aí o previsto fica guardado ao lado do recebido: a diferença
 * precisa aparecer, não sumir na edição.
 */
export const confirmPayout = (deps: ConfirmPayoutDeps) =>
  either(async function* (id: string, input: ConfirmPayoutInput) {
    const found = yield* await deps.unitOfWork.run<AppError, Transaction>(
      async (repositories) => {
        const transaction = await repositories.transactions.findById(id);
        if (transaction.isFailure()) return transaction;
        if (transaction.value === null) {
          return failure(new NotFoundError(`Lançamento ${id} não encontrado`));
        }

        return success(transaction.value);
      },
    );

    if (found.kind !== 'payout') {
      return yield* failure(
        new BadRequestError('Só provento tem recebimento a confirmar'),
      );
    }

    if (found.confirmed_at !== null) {
      return yield* failure(new ConflictError('Este provento já foi confirmado'));
    }

    return yield* await deps.unitOfWork.run<AppError, ConfirmPayoutResult>(
      async (repositories) => {
        const received = input.net_amount ?? found.net_amount;
        const diverged = received !== found.net_amount;

        const updated = await repositories.transactions.update(id, {
          confirmed_at: deps.clock.now().toISOString(),
          net_amount: received,
          ...(diverged ? { expected_net_amount: found.net_amount } : {}),
          ...(input.note === undefined ? {} : { note: input.note }),
        });
        if (updated.isFailure()) return updated;
        if (updated.value === null) {
          return failure(new NotFoundError(`Lançamento ${id} não encontrado`));
        }

        const enqueued = await repositories.outbox.enqueue([
          {
            stage: 'recalc',
            dedupe_key: dedupeKey.recalc(found.portfolio_id),
            payload: {
              portfolio_id: found.portfolio_id,
              from_date: found.trade_date,
            },
            ...(input.origin_request_id === undefined
              ? {}
              : { origin_request_id: input.origin_request_id }),
          },
        ]);
        if (enqueued.isFailure()) return enqueued;

        return success({
          transaction: updated.value,
          expected_net_amount: diverged ? found.net_amount : null,
          difference: diverged ? moneyDifference(received, found.net_amount) : null,
          queued: enqueued.value[0] ?? null,
        });
      },
      { lock: portfolioLock(found.portfolio_id) },
    );
  });
