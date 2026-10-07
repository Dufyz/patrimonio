import type { DateOnly, Transaction } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * O estado anterior guardado enquanto a janela do desfazer está aberta. Ele
 * carrega as linhas inteiras, com os ids: restaurar é reinserir o que está
 * aqui, e nada que apontava para o lançamento fica órfão.
 */
export type TransactionUndo = {
  readonly id: string;
  readonly transaction_id: string;
  readonly portfolio_id: string;
  readonly transactions: readonly Transaction[];
  readonly from_date: DateOnly;
  readonly expires_at: string;
  readonly created_at: string;
};

export type TransactionUndoDraft = {
  readonly transaction_id: string;
  readonly portfolio_id: string;
  readonly transactions: readonly Transaction[];
  readonly from_date: DateOnly;
  readonly expires_at: string;
};

export type TransactionUndoRepository = {
  readonly create: (
    draft: TransactionUndoDraft,
  ) => Promise<Either<AppError, TransactionUndo>>;

  readonly findById: (id: string) => Promise<Either<AppError, TransactionUndo | null>>;

  readonly remove: (id: string) => Promise<Either<AppError, boolean>>;
};
