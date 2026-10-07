import { either, failure } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type {
  TransactionFilter,
  TransactionRepository,
} from '../../interfaces/transaction.repository.js';

export type ListTransactionsDeps = { readonly transactions: TransactionRepository };

/** Caso de uso só de leitura: não tem plano, e o teste dele é o teste de rota. */
export const listTransactions = (deps: ListTransactionsDeps) =>
  either(async function* (filter: TransactionFilter) {
    return yield* await deps.transactions.list(filter);
  });

export const getTransaction = (deps: ListTransactionsDeps) =>
  either(async function* (id: string) {
    const transaction = yield* await deps.transactions.findById(id);

    if (transaction === null) {
      return yield* failure(new NotFoundError(`Lançamento ${id} não encontrado`));
    }

    return transaction;
  });
