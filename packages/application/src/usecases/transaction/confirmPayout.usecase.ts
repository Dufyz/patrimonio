import { moneyDifference } from '@patrimonio/calc';
import { dedupeKey } from '@patrimonio/domain';
import type { Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError, ConflictError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import type { AccountEffect } from '../ledger/contribution.usecase.js';
import { creditProvento } from '../ledger/provento_leg.js';
import { financeClock } from '../finance/clock.js';
import { portfolioLock } from './createTransaction.usecase.js';

export type ConfirmPayoutInput = {
  /** O líquido que de fato caiu na conta, quando diferente do previsto. */
  readonly net_amount?: string | undefined;
  readonly origin_request_id?: string | undefined;
};

export type ConfirmPayoutResult = {
  readonly transaction: Transaction;
  /** O previsto, guardado quando o recebido veio diferente. */
  readonly expected_net_amount: string | null;
  readonly difference: string | null;
  readonly queued: EnqueuedEvent | null;
  /** O crédito na conta de destino, quando o provento tem uma (LIV-05). */
  readonly account: AccountEffect | null;
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
        });
        if (updated.isFailure()) return updated;
        if (updated.value === null) {
          return failure(new NotFoundError(`Lançamento ${id} não encontrado`));
        }

        let account: AccountEffect | null = null;
        if (found.account_id !== undefined && found.account_id !== null) {
          const asset =
            found.asset_id === null
              ? null
              : await repositories.assets.findById(found.asset_id);
          const ticker =
            asset !== null && asset.isSuccess() && asset.value !== null
              ? asset.value.ticker
              : 'carteira';
          const credited = await creditProvento(repositories, {
            account_id: found.account_id,
            date: found.settlement_date,
            amount: received,
            ticker,
            event_id: found.event_id ?? repositories.transactions.nextId(),
            today: financeClock(deps.clock).today(),
          });
          if (credited.isFailure()) return credited;
          account = credited.value;
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
          account,
        });
      },
      { locks: ['finance', portfolioLock(found.portfolio_id)] },
    );
  });
