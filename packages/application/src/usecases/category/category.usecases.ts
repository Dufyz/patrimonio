import { either } from '@patrimonio/shared';

import type { CategoryRepository } from '../../interfaces/category.repository.js';

export type CategoryDeps = { readonly categories: CategoryRepository };

export const listCategories = (deps: CategoryDeps) =>
  either(async function* () {
    return yield* await deps.categories.list();
  });
