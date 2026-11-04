import type { Category } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type CategoryWrite = {
  readonly name?: string | undefined;
  readonly color_token?: string | undefined;
  readonly parent_id?: string | null | undefined;
  readonly auto_rule?: Record<string, unknown> | null | undefined;
};

export type CategoryDraft = CategoryWrite & {
  readonly name: string;
  readonly color_token: string;
};

/** O que impede excluir uma categoria: quem depende dela. */
export type CategoryUsage = {
  readonly children: number;
  readonly assets: number;
  readonly targets: number;
};

export type CategoryTargetRow = {
  readonly portfolio_id: string;
  readonly portfolio_name: string;
  readonly category_id: string;
};

export type CategoryRepository = {
  readonly findById: (id: string) => Promise<Either<AppError, Category | null>>;

  readonly list: () => Promise<Either<AppError, Category[]>>;

  readonly create: (draft: CategoryDraft) => Promise<Either<AppError, Category>>;

  readonly update: (
    id: string,
    patch: CategoryWrite,
  ) => Promise<Either<AppError, Category | null>>;

  readonly delete: (id: string) => Promise<Either<AppError, boolean>>;

  readonly usage: (id: string) => Promise<Either<AppError, CategoryUsage>>;

  /** Os alvos de estratégia de todas as carteiras: o que mover categoria precisa conferir. */
  readonly listTargets: () => Promise<Either<AppError, CategoryTargetRow[]>>;
};
