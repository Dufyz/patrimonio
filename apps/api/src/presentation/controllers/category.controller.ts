import type { listCategories } from '@patrimonio/application';
import type { RequestHandler } from 'express';

import { sendFailure } from '../middleware/respond.js';

export type CategoryDeps = {
  readonly usecases: {
    readonly listCategories: ReturnType<typeof listCategories>;
  };
};

export type CategoryController = {
  readonly list: RequestHandler;
};

export const createCategoryController = (deps: CategoryDeps): CategoryController => ({
  list: async (request, response) => {
    const result = await deps.usecases.listCategories();

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ categories: result.value });
  },
});
