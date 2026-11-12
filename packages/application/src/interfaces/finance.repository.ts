import type { finance as fin } from '@patrimonio/calc';

type FinChanges = fin.FinChanges;
import type { FinSnapshot } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/** A resposta guardada de uma chamada com `Idempotency-Key`. */
export type IdempotentRecord = {
  readonly operation: string;
  readonly status: number;
  readonly body: unknown;
};

/**
 * Finanças lê e grava por foto: `load` devolve tudo numa consulta, `persist`
 * grava a diferença entre a foto lida e a resultante. O cálculo mora em `calc`
 * e é o mesmo no preview e na gravação.
 */
export type FinanceRepository = {
  readonly load: () => Promise<Either<AppError, FinSnapshot>>;
  readonly persist: (changes: FinChanges) => Promise<Either<AppError, void>>;
  readonly findIdempotent: (
    key: string,
  ) => Promise<Either<AppError, IdempotentRecord | null>>;
  readonly saveIdempotent: (
    key: string,
    record: IdempotentRecord,
  ) => Promise<Either<AppError, void>>;
};

/** A diferença entre duas fotos, tabela por tabela: o que `persist` grava. */
export type FinanceChanges = FinChanges;
