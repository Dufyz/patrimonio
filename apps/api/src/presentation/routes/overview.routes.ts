import { getOverviewSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { OverviewDeps } from '../controllers/overview.controller.js';
import { createOverviewController } from '../controllers/overview.controller.js';
import { validate } from '../middleware/validate.js';

export const overviewRoutes = (deps: OverviewDeps): Router => {
  const router = Router();
  const controller = createOverviewController(deps);

  router.get('/overview', validate(getOverviewSchema), controller.overview);

  return router;
};
