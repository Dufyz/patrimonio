import { dedupeKey } from '@patrimonio/domain';
import type { PayoutDismissal, Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { portfolioLock } from './createTransaction.usecase.js';

export type DismissPayoutInput = {
  readonly reason: string;
  readonly origin_request_id?: string | undefined;
};

export type DismissPayoutResult = {
  readonly dismissal: PayoutDismissal;
  readonly queued: EnqueuedEvent | null;
};

export type DismissPayoutDeps = { readonly unitOfWork: UnitOfWork };

/**
 * "Não foi pago" tira o provento do livro, e o motivo sobrevive a isso: sem o
 * registro, um provento que some não tem explicação seis meses depois — e a
 * dúvida volta toda vez que a fonte anunciar o mesmo pagamento.
 */
export const dismissPayout = (deps: DismissPayoutDeps) =>
  either(async function* (id: string, input: DismissPayoutInput) {
    const payout = yield* await deps.unitOfWork.run<AppError, Transaction>(
      async (repositories) => {
        const found = await repositories.transactions.findById(id);
        if (found.isFailure()) return found;
        if (found.value === null) {
          return failure(new NotFoundError(`Lançamento ${id} não encontrado`));
        }

        return success(found.value);
      },
    );

    if (payout.kind !== 'payout') {
      return yield* failure(
        new BadRequestError('Só provento pode ser marcado como não pago'),
      );
    }

    if (payout.confirmed_at !== null) {
      return yield* failure(
        new BadRequestError(
          'Este provento já foi recebido: para desfazer, exclua o lançamento',
        ),
      );
    }

    return yield* await deps.unitOfWork.run<AppError, DismissPayoutResult>(
      async (repositories) => {
        const dismissal = await repositories.payoutDismissals.create({
          portfolio_id: payout.portfolio_id,
          asset_id: payout.asset_id,
          payout_kind: payout.payout_kind ?? 'dividend',
          record_date: payout.record_date ?? payout.trade_date,
          payment_date: payout.settlement_date,
          expected_net_amount: payout.net_amount,
          reason: input.reason,
        });
        if (dismissal.isFailure()) return dismissal;

        const removed = await repositories.transactions.remove(id);
        if (removed.isFailure()) return removed;

        const enqueued = await repositories.outbox.enqueue([
          {
            stage: 'recalc',
            dedupe_key: dedupeKey.recalc(payout.portfolio_id),
            payload: {
              portfolio_id: payout.portfolio_id,
              from_date: payout.trade_date,
            },
            ...(input.origin_request_id === undefined
              ? {}
              : { origin_request_id: input.origin_request_id }),
          },
        ]);
        if (enqueued.isFailure()) return enqueued;

        return success({
          dismissal: dismissal.value,
          queued: enqueued.value[0] ?? null,
        });
      },
      { lock: portfolioLock(payout.portfolio_id) },
    );
  });
