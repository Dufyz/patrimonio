import { listCategoriesSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { CategoryDeps } from '../controllers/category.controller.js';
import { createCategoryController } from '../controllers/category.controller.js';
import { validate } from '../middleware/validate.js';

export const categoryRoutes = (deps: CategoryDeps): Router => {
  const router = Router();
  const controller = createCategoryController(deps);

  router.get('/categories', validate(listCategoriesSchema), controller.list);

  return router;
};
