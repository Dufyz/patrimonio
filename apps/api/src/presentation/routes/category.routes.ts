import {
  createCategorySchema,
  deleteCategorySchema,
  listCategoriesSchema,
  updateCategorySchema,
} from '@patrimonio/contracts';
import { Router } from 'express';

import type { CategoryDeps } from '../controllers/category.controller.js';
import { createCategoryController } from '../controllers/category.controller.js';
import { validate } from '../middleware/validate.js';

export const categoryRoutes = (deps: CategoryDeps): Router => {
  const router = Router();
  const controller = createCategoryController(deps);

  router.get('/categories', validate(listCategoriesSchema), controller.list);
  router.post('/categories', validate(createCategorySchema), controller.create);
  router.patch(
    '/categories/:category_id',
    validate(updateCategorySchema),
    controller.update,
  );
  router.delete(
    '/categories/:category_id',
    validate(deleteCategorySchema),
    controller.remove,
  );

  return router;
};
