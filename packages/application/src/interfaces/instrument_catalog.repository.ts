import type { DateOnly, InstrumentType, ListedInstrument } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type InstrumentWrite = {
  readonly ticker: string;
  readonly name: string;
  readonly b3_type: InstrumentType;
  readonly maturity_date: DateOnly | null;
  readonly source: string;
  readonly active: boolean;
  readonly last_trade_date: DateOnly | null;
};

export type InstrumentFilter = {
  /** Sem texto, lista por ordem de ticker. */
  readonly text?: string | undefined;
  readonly types?: readonly InstrumentType[] | undefined;
  readonly includeInactive?: boolean | undefined;
  readonly limit: number;
};

export type InstrumentPage = {
  readonly items: ListedInstrument[];
  /** Quantos casam, mesmo além do limite. */
  readonly total: number;
};

export type InstrumentCatalogSummary = {
  readonly total: number;
  readonly active: number;
  readonly by_type: Readonly<Record<InstrumentType, number>>;
  readonly last_loaded_at: string | null;
};

/**
 * O catálogo de papéis do mercado. A leitura não depende de carteira, posição ou
 * lançamento: a busca do lançamento e a futura tela de descoberta usam a mesma
 * consulta. A escrita é só da carga.
 */
export type InstrumentCatalogRepository = {
  readonly search: (filter: InstrumentFilter) => Promise<Either<AppError, InstrumentPage>>;

  readonly findByTicker: (
    ticker: string,
  ) => Promise<Either<AppError, ListedInstrument | null>>;

  /** Em lote e idempotente: recarregar a mesma fonte não duplica nada. */
  readonly upsertMany: (
    rows: readonly InstrumentWrite[],
  ) => Promise<Either<AppError, { readonly created: number; readonly updated: number }>>;

  /** Marca como inativo o que a fonte não trouxe mais; devolve quantos mudaram. */
  readonly deactivateMissing: (
    source: string,
    keep: readonly string[],
  ) => Promise<Either<AppError, number>>;

  readonly summary: () => Promise<Either<AppError, InstrumentCatalogSummary>>;
};
