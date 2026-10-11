import type { Category } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type CategoryRepository = {
  readonly findById: (id: string) => Promise<Either<AppError, Category | null>>;

  readonly list: () => Promise<Either<AppError, Category[]>>;
};
