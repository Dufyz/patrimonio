import { getProjectionSchema, putProjectionPlanSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { ProjectionDeps } from '../controllers/projection.controller.js';
import { createProjectionController } from '../controllers/projection.controller.js';
import { validate } from '../middleware/validate.js';

export const projectionRoutes = (deps: ProjectionDeps): Router => {
  const router = Router();
  const controller = createProjectionController(deps);

  router.get('/projection', validate(getProjectionSchema), controller.get);
  router.put(
    '/portfolios/:portfolio_id/projection-plan',
    validate(putProjectionPlanSchema),
    controller.put,
  );

  return router;
};
