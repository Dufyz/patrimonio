import { dedupeKey, minDateOnly } from '@patrimonio/domain';
import type { DateOnly, Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { TransactionPatch } from '../../interfaces/transaction.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import type { TransactionPreview } from '../../plans/transaction.plan.js';
import { portfolioLock, prepareTransaction } from './createTransaction.usecase.js';
import type {
  CreateTransactionInput,
  PreparedTransaction,
} from './createTransaction.usecase.js';

export type UpdateTransactionInput = {
  readonly portfolio_id?: string | undefined;
  readonly institution_id?: string | undefined;
  readonly asset_id?: string | undefined;
  readonly trade_date?: DateOnly | undefined;
  readonly settlement_date?: DateOnly | undefined;
  readonly quantity?: string | undefined;
  readonly unit_price?: string | undefined;
  readonly fees?: string | undefined;
  readonly tax_withheld?: string | undefined;
  readonly note?: string | undefined;
  readonly origin_request_id?: string | undefined;
};

export type UpdateTransactionResult = {
  readonly transaction: Transaction;
  readonly preview: TransactionPreview;
  readonly queued: readonly EnqueuedEvent[];
};

export type UpdateTransactionDeps = { readonly unitOfWork: UnitOfWork };

/** O lançamento gravado, mesclado com o que a edição mudou. */
const merged = (
  current: Transaction,
  input: UpdateTransactionInput,
): CreateTransactionInput => {
  const assetId = input.asset_id ?? current.asset_id;
  const note = input.note ?? current.note;

  return {
    kind: current.kind,
    portfolio_id: input.portfolio_id ?? current.portfolio_id,
    institution_id: input.institution_id ?? current.institution_id,
    ...(assetId === null ? {} : { asset_id: assetId }),
    trade_date: input.trade_date ?? current.trade_date,
    settlement_date: input.settlement_date ?? current.settlement_date,
    quantity: input.quantity ?? current.quantity,
    unit_price: input.unit_price ?? current.unit_price,
    fees: input.fees ?? current.fees,
    tax_withheld: input.tax_withheld ?? current.tax_withheld,
    ...(current.payout_kind === null ? {} : { payout_kind: current.payout_kind }),
    ...(current.record_date === null ? {} : { record_date: current.record_date }),
    ...(note === null ? {} : { note }),
    ...(input.origin_request_id === undefined
      ? {}
      : { origin_request_id: input.origin_request_id }),
  };
};

const loadForUpdate = async (
  repositories: TransactionalRepositories,
  id: string,
): Promise<Either<AppError, Transaction>> => {
  const found = await repositories.transactions.findById(id);
  if (found.isFailure()) return found;
  if (found.value === null) {
    return failure(new NotFoundError(`Lançamento ${id} não encontrado`));
  }

  return success(found.value);
};

const prepareUpdate = async (
  repositories: TransactionalRepositories,
  current: Transaction,
  input: UpdateTransactionInput,
  options: { readonly create: boolean },
): Promise<Either<AppError, PreparedTransaction>> =>
  prepareTransaction(repositories, merged(current, input), {
    replacing: current,
    create: options.create,
  });

/**
 * Toda edição mostra o que vai mudar antes de salvar, e os números do preview
 * são os mesmos que ficam gravados: é o mesmo plano, com o lançamento antigo
 * fora da sequência e o novo dentro.
 *
 * Salvar enfileira o recálculo com `from_date` igual à data mais antiga tocada —
 * a nova ou a antiga, o que for anterior — e o modal fecha na hora: a
 * reconstrução acontece atrás.
 */
export const updateTransaction = (deps: UpdateTransactionDeps) =>
  either(async function* (id: string, input: UpdateTransactionInput) {
    const current = yield* await deps.unitOfWork.run<AppError, Transaction>(
      async (repositories) => loadForUpdate(repositories, id),
    );

    return yield* await deps.unitOfWork.run<AppError, UpdateTransactionResult>(
      async (repositories) => {
        const prepared = await prepareUpdate(repositories, current, input, {
          create: true,
        });
        if (prepared.isFailure()) return prepared;

        const row = prepared.value.row;

        const patch: TransactionPatch = {
          trade_date: row.trade_date,
          settlement_date: row.settlement_date,
          portfolio_id: row.portfolio_id,
          asset_id: row.asset_id ?? null,
          institution_id: row.institution_id,
          quantity: row.quantity,
          unit_price: row.unit_price,
          fees: row.fees,
          gross_amount: row.gross_amount,
          net_amount: row.net_amount,
          tax_withheld: row.tax_withheld ?? current.tax_withheld,
          note: row.note ?? null,
        };

        const updated = await repositories.transactions.update(id, patch);
        if (updated.isFailure()) return updated;
        if (updated.value === null) {
          return failure(new NotFoundError(`Lançamento ${id} não encontrado`));
        }

        const fromDate = minDateOnly(row.trade_date, current.trade_date);
        const origin =
          input.origin_request_id === undefined
            ? {}
            : { origin_request_id: input.origin_request_id };

        // Mudar o lançamento de carteira muda as duas: a de onde ele saiu e a
        // para onde ele foi.
        const touched = new Set([current.portfolio_id, row.portfolio_id]);

        const enqueued = await repositories.outbox.enqueue(
          [...touched].map((portfolioId) => ({
            stage: 'recalc' as const,
            dedupe_key: dedupeKey.recalc(portfolioId),
            payload: { portfolio_id: portfolioId, from_date: fromDate },
            ...origin,
          })),
        );
        if (enqueued.isFailure()) return enqueued;

        return success({
          transaction: updated.value,
          preview: prepared.value.plan.preview,
          queued: enqueued.value,
        });
      },
      { lock: portfolioLock(current.portfolio_id) },
    );
  });

/** O mesmo plano da edição, sem gravar: é o que o modal mostra. */
export const previewUpdate = (deps: UpdateTransactionDeps) =>
  either(async function* (id: string, input: UpdateTransactionInput) {
    return yield* await deps.unitOfWork.run<AppError, TransactionPreview>(
      async (repositories) => {
        const current = await loadForUpdate(repositories, id);
        if (current.isFailure()) return current;

        const prepared = await prepareUpdate(repositories, current.value, input, {
          create: false,
        });
        if (prepared.isFailure()) return prepared;

        return success(prepared.value.plan.preview);
      },
    );
  });
