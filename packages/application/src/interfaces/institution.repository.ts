import type { Institution } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type InstitutionWrite = {
  readonly name?: string | undefined;
  readonly country?: string | undefined;
};

export type InstitutionDraft = InstitutionWrite & {
  readonly name: string;
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
};
