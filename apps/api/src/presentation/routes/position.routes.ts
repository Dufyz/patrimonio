import { listPositionsSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { PositionDeps } from '../controllers/position.controller.js';
import { createPositionController } from '../controllers/position.controller.js';
import { validate } from '../middleware/validate.js';

export const positionRoutes = (deps: PositionDeps): Router => {
  const router = Router();
  const controller = createPositionController(deps);

  router.get('/positions', validate(listPositionsSchema), controller.list);

  return router;
};
