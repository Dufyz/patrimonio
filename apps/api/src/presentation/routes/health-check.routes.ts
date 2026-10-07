import { getHealthCheckSchema, getLiveSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { HealthCheckDeps } from '../controllers/health-check.controller.js';
import { createHealthCheckController } from '../controllers/health-check.controller.js';
import { validate } from '../middleware/validate.js';

export const healthCheckRoutes = (deps: HealthCheckDeps): Router => {
  const router = Router();
  const controller = createHealthCheckController(deps);

  router.get('/health-check/live', validate(getLiveSchema), controller.live);
  router.get('/health-check', validate(getHealthCheckSchema), controller.deep);

  return router;
};
