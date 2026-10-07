import type {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '@patrimonio/application';
import type { CreateCategoryBody, UpdateCategoryBody } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure } from '../middleware/respond.js';

export type CategoryDeps = {
  readonly usecases: {
    readonly listCategories: ReturnType<typeof listCategories>;
    readonly createCategory: ReturnType<typeof createCategory>;
    readonly updateCategory: ReturnType<typeof updateCategory>;
    readonly deleteCategory: ReturnType<typeof deleteCategory>;
  };
};

export type CategoryController = {
  readonly list: RequestHandler;
  readonly create: RequestHandler;
  readonly update: RequestHandler;
  readonly remove: RequestHandler;
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

  create: async (request, response) => {
    const result = await deps.usecases.createCategory(request.body as CreateCategoryBody);

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(201).json({ category: result.value, message: 'Categoria criada' });
  },

  update: async (request, response) => {
    const result = await deps.usecases.updateCategory(
      String(request.params['category_id']),
      request.body as UpdateCategoryBody,
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response
      .status(200)
      .json({ category: result.value, message: 'Categoria atualizada' });
  },

  remove: async (request, response) => {
    const result = await deps.usecases.deleteCategory(
      String(request.params['category_id']),
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ result: result.value, message: 'Categoria excluída' });
  },
});
