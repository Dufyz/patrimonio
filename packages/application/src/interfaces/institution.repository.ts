import type { Institution, InstitutionRole } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type InstitutionWrite = {
  readonly name?: string | undefined;
  readonly role?: InstitutionRole | undefined;
  readonly fgc_covered?: boolean | undefined;
  readonly brokerage_per_order?: string | undefined;
  readonly custody_monthly_fee?: string | undefined;
};

export type InstitutionDraft = InstitutionWrite & {
  readonly name: string;
  readonly role: InstitutionRole;
};

/**
 * A soma por emissor é o que o limite de R$ 250 mil mede, e ela sai do livro:
 * quanto foi aplicado menos quanto foi resgatado nos títulos daquele emissor.
 */
export type IssuerExposure = {
  readonly exposure_brl: string;
  readonly assets: number;
};

export type InstitutionUsage = {
  readonly transactions: number;
  readonly assets: number;
};

export type InstitutionRepository = {
  readonly findById: (id: string) => Promise<Either<AppError, Institution | null>>;

  readonly findByName: (name: string) => Promise<Either<AppError, Institution | null>>;

  readonly list: () => Promise<Either<AppError, Institution[]>>;

  readonly create: (draft: InstitutionDraft) => Promise<Either<AppError, Institution>>;

  readonly update: (
    id: string,
    patch: InstitutionWrite,
  ) => Promise<Either<AppError, Institution | null>>;

  readonly remove: (id: string) => Promise<Either<AppError, boolean>>;

  readonly usage: (id: string) => Promise<Either<AppError, InstitutionUsage>>;

  readonly issuerExposure: (id: string) => Promise<Either<AppError, IssuerExposure>>;
};
