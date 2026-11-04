import {
  deleteGoalSchema,
  getGoalsOverviewSchema,
  getGoalsSchema,
  previewGoalSchema,
  putGoalSchema,
} from '@patrimonio/contracts';
import { Router } from 'express';

import type { GoalDeps } from '../controllers/goal.controller.js';
import { createGoalController } from '../controllers/goal.controller.js';
import { validate } from '../middleware/validate.js';

export const goalRoutes = (deps: GoalDeps): Router => {
  const router = Router();
  const controller = createGoalController(deps);

  router.get('/goals', validate(getGoalsSchema), controller.goals);
  router.get('/goals/overview', validate(getGoalsOverviewSchema), controller.overview);
  router.put('/portfolios/:portfolio_id/goal', validate(putGoalSchema), controller.put);
  router.delete(
    '/portfolios/:portfolio_id/goal',
    validate(deleteGoalSchema),
    controller.remove,
  );
  router.post(
    '/portfolios/:portfolio_id/goal/preview',
    validate(previewGoalSchema),
    controller.preview,
  );

  return router;
};
