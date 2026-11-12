import { finance as fin, ledgerEffects } from '@patrimonio/calc';
import { dedupeKey } from '@patrimonio/domain';
import type {
  FinEntry,
  FinMovement,
  OutboxEventDraft,
  Transaction,
} from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { ConflictError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import { FinanceError } from '../../errors/finance-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { TransactionWrite } from '../../interfaces/transaction.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { planDeletion } from '../../plans/transaction.plan.js';
import type { DeletionPreview } from '../../plans/transaction.plan.js';
import { loadPlanContext } from './context.js';
import type { ContextAsset } from './context.js';
import { portfolioLock } from './createTransaction.usecase.js';

/** O que fazer com a despesa ligada ao resgate quando ele é excluído (RN-U6). */
export type LinkedExpenseChoice = 'excluir' | 'manter';

export type DeleteContext = {
  readonly origin_request_id?: string | undefined;
  readonly linked_expense?: LinkedExpenseChoice | undefined;
};

const rule = (code: string, message: string, field: string, status = 422) =>
  failure(new FinanceError([{ code, message, field }], status));

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
  event_ratio_from: transaction.event_ratio_from,
  event_ratio_to: transaction.event_ratio_to,
  idempotency_key: transaction.idempotency_key,
  event_id: transaction.event_id ?? null,
  account_id: transaction.account_id ?? null,
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
  either(async function* (id: string, context: DeleteContext = {}) {
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

        const planContext = await loadPlanContext(repositories, {
          portfolio_id: current.portfolio_id,
          asset,
          institution_id: current.institution_id,
        });
        if (planContext.isFailure()) return planContext;

        // LIV-12: excluir não pode deixar a posição negativa em dia nenhum. O
        // primeiro dia afetado é o da primeira venda que passa a faltar quantidade.
        const remaining = planContext.value.asset_entries.filter(
          (entry) => entry.id !== current.id,
        );
        const wasOversold = [
          ...ledgerEffects(planContext.value.asset_entries).values(),
        ].some((effect) => effect.oversold);
        if (!wasOversold) {
          const effects = ledgerEffects(remaining);
          const first = remaining.find(
            (entry) => entry.id !== undefined && effects.get(entry.id)?.oversold === true,
          );
          if (first !== undefined) {
            return rule(
              'POSICAO_NEGATIVA',
              `Excluir deixaria a posição negativa a partir de ${first.trade_date}.`,
              'trade_date',
            );
          }
        }

        const impact = planDeletion(planContext.value, [current]);

        // As pernas financeiras saem na mesma transação (LIV-12, RN-U6).
        let legs: { movements: FinMovement[]; entries: FinEntry[] } = {
          movements: [],
          entries: [],
        };
        if (current.event_id !== undefined && current.event_id !== null) {
          const loaded = await repositories.finance.load();
          if (loaded.isFailure()) return loaded;
          const before = loaded.value;
          const eventId = current.event_id;
          const movements = before.movements.filter((m) => m.event_id === eventId);
          const linked = before.entries.filter((e) => e.event_id === eventId);

          if (linked.length > 0 && context.linked_expense === undefined) {
            return rule(
              'DESPESA_LIGADA_DECISAO',
              'Este resgate gerou uma despesa. Escolha excluir ou manter a despesa.',
              'linked_expense',
              409,
            );
          }

          const dropEntries = context.linked_expense === 'excluir' ? linked : [];
          const after = {
            ...before,
            movements: before.movements.filter((m) => m.event_id !== eventId),
            entries: before.entries
              .filter((e) => !dropEntries.some((d) => d.id === e.id))
              // A despesa mantida deixa de apontar para o resgate que sumiu.
              .map((e) => (e.event_id === eventId ? { ...e, event_id: null } : e)),
          };
          if (movements.length > 0 || linked.length > 0) {
            const saved = await repositories.finance.persist(
              fin.diffSnapshots(before, after),
            );
            if (saved.isFailure()) return saved;
          }
          legs = { movements, entries: linked };
        }

        const removed = await repositories.transactions.remove(id);
        if (removed.isFailure()) return removed;
        if (removed.value === null) {
          return failure(new NotFoundError(`Lançamento ${id} não encontrado`));
        }

        const deleted: Transaction[] = [removed.value];

        const expiresAt = new Date(
          deps.clock.now().getTime() + deps.undoWindowSeconds * 1_000,
        ).toISOString();

        const undo = await repositories.transactionUndos.create({
          transaction_id: id,
          portfolio_id: current.portfolio_id,
          transactions: deleted,
          legs,
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
      { locks: ['finance', portfolioLock(current.portfolio_id)] },
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

        const stored = undo.value;
        if (stored.legs.movements.length > 0 || stored.legs.entries.length > 0) {
          const loaded = await repositories.finance.load();
          if (loaded.isFailure()) return loaded;
          const before = loaded.value;
          const after = {
            ...before,
            movements: [
              ...before.movements.filter(
                (m) => !stored.legs.movements.some((l) => l.id === m.id),
              ),
              ...stored.legs.movements,
            ],
            entries: [
              ...before.entries.filter(
                (e) => !stored.legs.entries.some((l) => l.id === e.id),
              ),
              ...stored.legs.entries,
            ],
          };
          const saved = await repositories.finance.persist(
            fin.diffSnapshots(before, after),
          );
          if (saved.isFailure()) return saved;
        }

        const removed = await repositories.transactionUndos.remove(undoId);
        if (removed.isFailure()) return removed;

        const enqueued = await repositories.outbox.enqueue(
          recalcEvents(restored.value, context.origin_request_id),
        );
        if (enqueued.isFailure()) return enqueued;

        return success({ restored: restored.value, queued: enqueued.value });
      },
      { lock: 'finance' },
    );
  });
