import { dedupeKey } from '@patrimonio/domain';
import type { OutboxEventDraft, Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { ConflictError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { TransactionWrite } from '../../interfaces/transaction.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { planDeletion } from '../../plans/transaction.plan.js';
import type { DeletionPreview } from '../../plans/transaction.plan.js';
import { loadPlanContext } from './context.js';
import type { ContextAsset } from './context.js';
import { portfolioLock } from './createTransaction.usecase.js';

export type DeleteTransactionResult = {
  readonly deleted: readonly Transaction[];
  readonly impact: DeletionPreview;
  /** O token do desfazer e até quando ele vale. */
  readonly undo_id: string;
  readonly undo_expires_at: string;
  readonly queued: readonly EnqueuedEvent[];
};

export type DeleteTransactionDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** 5, 8 ou 15 segundos, de `packages/env`. */
  readonly undoWindowSeconds: number;
};

const asWrite = (transaction: Transaction): TransactionWrite => ({
  id: transaction.id,
  kind: transaction.kind,
  trade_date: transaction.trade_date,
  settlement_date: transaction.settlement_date,
  portfolio_id: transaction.portfolio_id,
  asset_id: transaction.asset_id,
  institution_id: transaction.institution_id,
  quantity: transaction.quantity,
  unit_price: transaction.unit_price,
  fees: transaction.fees,
  gross_amount: transaction.gross_amount,
  tax_withheld: transaction.tax_withheld,
  net_amount: transaction.net_amount,
  payout_kind: transaction.payout_kind,
  expected_net_amount: transaction.expected_net_amount,
  record_date: transaction.record_date,
  confirmed_at: transaction.confirmed_at,
  transfer_group_id: transaction.transfer_group_id,
  event_ratio_from: transaction.event_ratio_from,
  event_ratio_to: transaction.event_ratio_to,
  note: transaction.note,
  idempotency_key: transaction.idempotency_key,
});

const recalcEvents = (
  transactions: readonly Transaction[],
  originRequestId: string | undefined,
): OutboxEventDraft[] => {
  const earliest = new Map<string, string>();

  for (const transaction of transactions) {
    const current = earliest.get(transaction.portfolio_id);
    if (current === undefined || transaction.trade_date < current) {
      earliest.set(transaction.portfolio_id, transaction.trade_date);
    }
  }

  return [...earliest].map(([portfolioId, fromDate]) => ({
    stage: 'recalc' as const,
    dedupe_key: dedupeKey.recalc(portfolioId),
    payload: { portfolio_id: portfolioId, from_date: fromDate },
    ...(originRequestId === undefined ? {} : { origin_request_id: originRequestId }),
  }));
};

/**
 * Excluir mostra o impacto e deixa desfazer por alguns segundos. A linha some do
 * livro, mas fica guardada inteira — com o id — até a janela fechar: restaurar é
 * reinserir o que foi guardado, e o estado anterior volta idêntico, inclusive os
 * eventos de recálculo.
 */
export const deleteTransaction = (deps: DeleteTransactionDeps) =>
  either(async function* (
    id: string,
    context: { readonly origin_request_id?: string | undefined } = {},
  ) {
    const current = yield* await deps.unitOfWork.run<AppError, Transaction>(
      async (repositories) => {
        const found = await repositories.transactions.findById(id);
        if (found.isFailure()) return found;
        if (found.value === null) {
          return failure(new NotFoundError(`Lançamento ${id} não encontrado`));
        }

        return success(found.value);
      },
    );

    return yield* await deps.unitOfWork.run<AppError, DeleteTransactionResult>(
      async (repositories) => {
        // As duas pernas de uma transferência saem juntas: deixar uma sozinha
        // mudaria o patrimônio total de um lado só.
        const group = current.transfer_group_id;

        const assetId = current.asset_id;
        let asset: ContextAsset | null = null;

        if (assetId !== null) {
          const found = await repositories.assets.findById(assetId);
          if (found.isFailure()) return found;
          if (found.value !== null) {
            asset = {
              id: found.value.id,
              ticker: found.value.ticker,
              category_id: found.value.category_id,
              is_new: false,
            };
          }
        }

        const toDelete =
          group === null
            ? [current]
            : await (async () => {
                const legs = await repositories.transactions.findByTransferGroup(group);
                return legs.isSuccess() ? legs.value : [current];
              })();

        const planContext = await loadPlanContext(repositories, {
          portfolio_id: current.portfolio_id,
          asset,
          institution_id: current.institution_id,
        });
        if (planContext.isFailure()) return planContext;

        const impact = planDeletion(planContext.value, toDelete);

        const removed =
          group === null
            ? await repositories.transactions.remove(id)
            : await repositories.transactions.removeByTransferGroup(group);
        if (removed.isFailure()) return removed;

        const deleted: Transaction[] =
          removed.value === null
            ? []
            : Array.isArray(removed.value)
              ? removed.value
              : [removed.value];

        if (deleted.length === 0) {
          return failure(new NotFoundError(`Lançamento ${id} não encontrado`));
        }

        const expiresAt = new Date(
          deps.clock.now().getTime() + deps.undoWindowSeconds * 1_000,
        ).toISOString();

        const undo = await repositories.transactionUndos.create({
          transaction_id: id,
          portfolio_id: current.portfolio_id,
          transactions: deleted,
          from_date: deleted.reduce(
            (earliest, transaction) =>
              transaction.trade_date < earliest ? transaction.trade_date : earliest,
            deleted[0]?.trade_date ?? current.trade_date,
          ),
          expires_at: expiresAt,
        });
        if (undo.isFailure()) return undo;

        const enqueued = await repositories.outbox.enqueue(
          recalcEvents(deleted, context.origin_request_id),
        );
        if (enqueued.isFailure()) return enqueued;

        return success({
          deleted,
          impact,
          undo_id: undo.value.id,
          undo_expires_at: expiresAt,
          queued: enqueued.value,
        });
      },
      { lock: portfolioLock(current.portfolio_id) },
    );
  });

export type UndoResult = {
  readonly restored: readonly Transaction[];
  readonly queued: readonly EnqueuedEvent[];
};

/**
 * O desfazer restaura o estado anterior, inclusive os eventos de recálculo: o
 * livro volta a ter a linha e a projeção volta a ser reconstruída a partir dela.
 */
export const undoDeletion = (deps: DeleteTransactionDeps) =>
  either(async function* (
    undoId: string,
    context: { readonly origin_request_id?: string | undefined } = {},
  ) {
    return yield* await deps.unitOfWork.run<AppError, UndoResult>(
      async (repositories) => {
        const undo = await repositories.transactionUndos.findById(undoId);
        if (undo.isFailure()) return undo;
        if (undo.value === null) {
          return failure(new NotFoundError('Não há o que desfazer com esse token'));
        }

        if (new Date(undo.value.expires_at).getTime() < deps.clock.now().getTime()) {
          return failure(
            new ConflictError(
              'A janela do desfazer fechou: lance de novo, se o lançamento era para existir',
            ),
          );
        }

        const restored = await repositories.transactions.insertMany(
          undo.value.transactions.map((transaction) => asWrite(transaction)),
        );
        if (restored.isFailure()) return restored;

        const removed = await repositories.transactionUndos.remove(undoId);
        if (removed.isFailure()) return removed;

        const enqueued = await repositories.outbox.enqueue(
          recalcEvents(restored.value, context.origin_request_id),
        );
        if (enqueued.isFailure()) return enqueued;

        return success({ restored: restored.value, queued: enqueued.value });
      },
    );
  });
