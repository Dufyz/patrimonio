import type { DateOnly, ManualPrice } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type ManualPriceDraft = {
  readonly asset_id: string;
  readonly price_date: DateOnly;
  readonly price: string;
};

export type ManualPriceRepository = {
  /** Redefinir o preço do mesmo dia atualiza a linha, em vez de criar outra. */
  readonly upsert: (draft: ManualPriceDraft) => Promise<Either<AppError, ManualPrice>>;

  readonly listByAsset: (assetId: string) => Promise<Either<AppError, ManualPrice[]>>;

  /** O último preço manual até uma data: é o que vale naquele dia. */
  readonly latestUntil: (
    assetId: string,
    date: DateOnly,
  ) => Promise<Either<AppError, ManualPrice | null>>;

  readonly remove: (
    assetId: string,
    date: DateOnly,
  ) => Promise<Either<AppError, boolean>>;
};
