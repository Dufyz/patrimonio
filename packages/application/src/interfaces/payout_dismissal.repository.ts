import type { DateOnly, PayoutDismissal, PayoutKind } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type PayoutDismissalDraft = {
  readonly portfolio_id: string;
  readonly asset_id: string | null;
  readonly payout_kind: PayoutKind;
  readonly record_date: DateOnly;
  readonly payment_date: DateOnly;
  readonly expected_net_amount: string;
  readonly reason: string;
};

export type PayoutDismissalRepository = {
  readonly create: (
    draft: PayoutDismissalDraft,
  ) => Promise<Either<AppError, PayoutDismissal>>;

  readonly listByPortfolio: (
    portfolioId: string,
  ) => Promise<Either<AppError, PayoutDismissal[]>>;
};
