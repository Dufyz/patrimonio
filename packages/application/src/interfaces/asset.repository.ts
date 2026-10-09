import type {
  Asset,
  AssetOrigin,
  B3Type,
  DateOnly,
  Indexer,
  LiquidityKind,
  PriceSource,
  TaxRegime,
} from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type AssetWrite = {
  readonly ticker?: string | undefined;
  readonly name?: string | undefined;
  readonly b3_type?: B3Type | null | undefined;
  readonly category_id?: string | null | undefined;
  readonly sector?: string | null | undefined;
  readonly price_source?: PriceSource | undefined;
  readonly issuer_id?: string | null | undefined;
  readonly indexer?: Indexer | null | undefined;
  readonly rate?: string | null | undefined;
  readonly issued_at?: DateOnly | null | undefined;
  readonly maturity_date?: DateOnly | null | undefined;
  readonly liquidity?: LiquidityKind | null | undefined;
  readonly liquidity_days?: number | null | undefined;
  readonly tax_regime?: TaxRegime | null | undefined;
};

export type AssetDraft = AssetWrite & {
  readonly ticker: string;
  readonly name: string;
  readonly origin: AssetOrigin;
};

export type AssetFilter = {
  readonly search?: string | undefined;
  readonly origin?: AssetOrigin | undefined;
  readonly includeArchived?: boolean | undefined;
};

export type AssetUsage = {
  readonly transactions: number;
  readonly portfolios: number;
};

export type AssetRepository = {
  readonly findById: (id: string) => Promise<Either<AppError, Asset | null>>;

  readonly findByTicker: (ticker: string) => Promise<Either<AppError, Asset | null>>;

  readonly list: (filter: AssetFilter) => Promise<Either<AppError, Asset[]>>;

  /**
   * Os ativos que aparecem no livro de uma carteira, numa consulta. O fechamento
   * diário precisa dos termos de cada um — indexador, emissão, vencimento — e
   * buscá-los um por um seria N+1 vezes trezentos, todos os dias.
   */
  readonly listForPortfolio: (portfolioId: string) => Promise<Either<AppError, Asset[]>>;

  readonly create: (draft: AssetDraft) => Promise<Either<AppError, Asset>>;

  readonly update: (
    id: string,
    patch: AssetWrite,
  ) => Promise<Either<AppError, Asset | null>>;

  readonly setArchived: (
    id: string,
    archived: boolean,
  ) => Promise<Either<AppError, Asset | null>>;

  readonly remove: (id: string) => Promise<Either<AppError, boolean>>;

  readonly usage: (id: string) => Promise<Either<AppError, AssetUsage>>;
};
