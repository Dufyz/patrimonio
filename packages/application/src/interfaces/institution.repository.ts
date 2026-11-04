import type { Institution } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type InstitutionRepository = {
  readonly findById: (id: string) => Promise<Either<AppError, Institution | null>>;

  readonly list: () => Promise<Either<AppError, Institution[]>>;
};
