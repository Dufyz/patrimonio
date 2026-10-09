import { getAllocationSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { AllocationDeps } from '../controllers/allocation.controller.js';
import { createAllocationController } from '../controllers/allocation.controller.js';
import { validate } from '../middleware/validate.js';

export const allocationRoutes = (deps: AllocationDeps): Router => {
  const router = Router();
  const controller = createAllocationController(deps);

  router.get('/allocation', validate(getAllocationSchema), controller.allocation);

  return router;
};
