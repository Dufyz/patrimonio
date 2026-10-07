import type { Category } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type CategoryWrite = {
  readonly name?: string | undefined;
  readonly parent_id?: string | null | undefined;
  readonly color_token?: string | undefined;
  readonly auto_rule?: Record<string, unknown> | null | undefined;
  readonly sort_order?: number | undefined;
};

export type CategoryDraft = CategoryWrite & {
  readonly name: string;
  readonly color_token: string;
};

export type CategoryUsage = {
  readonly assets: number;
  readonly targets: number;
  readonly children: number;
};

export type CategoryRepository = {
  readonly findById: (id: string) => Promise<Either<AppError, Category | null>>;

  readonly list: () => Promise<Either<AppError, Category[]>>;

  readonly create: (draft: CategoryDraft) => Promise<Either<AppError, Category>>;

  readonly update: (
    id: string,
    patch: CategoryWrite,
  ) => Promise<Either<AppError, Category | null>>;

  readonly remove: (id: string) => Promise<Either<AppError, boolean>>;

  /** O que impede a exclusão: ativos, alvos de estratégia e categorias filhas. */
  readonly usage: (id: string) => Promise<Either<AppError, CategoryUsage>>;
};
