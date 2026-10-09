import { getPerformanceSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { PerformanceDeps } from '../controllers/performance.controller.js';
import { createPerformanceController } from '../controllers/performance.controller.js';
import { validate } from '../middleware/validate.js';

export const performanceRoutes = (deps: PerformanceDeps): Router => {
  const router = Router();
  const controller = createPerformanceController(deps);

  router.get('/performance', validate(getPerformanceSchema), controller.performance);

  return router;
};
