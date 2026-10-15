import type { CustodyTransfer, DateOnly } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type CustodyTransferDraft = {
  readonly portfolio_id: string;
  readonly asset_id: string;
  readonly from_institution_id: string;
  readonly to_institution_id: string;
  readonly transfer_date: DateOnly;
  readonly note: string | null;
};

/** Onde o papel está custodiado, e desde quando essa informação vale. */
export type CurrentCustody = {
  readonly institution_id: string;
  /** A data do lançamento ou da transferência que fixou a custódia. */
  readonly as_of: DateOnly;
};

export type CustodyTransferRepository = {
  readonly create: (
    draft: CustodyTransferDraft,
  ) => Promise<Either<AppError, CustodyTransfer>>;

  /** Da mais recente para a mais antiga. */
  readonly listByPortfolioAsset: (
    portfolioId: string,
    assetId: string,
  ) => Promise<Either<AppError, CustodyTransfer[]>>;

  readonly findById: (id: string) => Promise<Either<AppError, CustodyTransfer | null>>;

  /**
   * A instituição do lançamento ou da transferência mais recente daquele ativo
   * naquela carteira. Nulo quando o ativo nunca teve lançamento nela.
   */
  readonly currentCustody: (
    portfolioId: string,
    assetId: string,
  ) => Promise<Either<AppError, CurrentCustody | null>>;

  readonly remove: (id: string) => Promise<Either<AppError, boolean>>;
};
