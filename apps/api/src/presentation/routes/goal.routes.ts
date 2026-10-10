import { getGoalsSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { GoalDeps } from '../controllers/goal.controller.js';
import { createGoalController } from '../controllers/goal.controller.js';
import { validate } from '../middleware/validate.js';

export const goalRoutes = (deps: GoalDeps): Router => {
  const router = Router();
  const controller = createGoalController(deps);

  router.get('/goals', validate(getGoalsSchema), controller.goals);

  return router;
};
