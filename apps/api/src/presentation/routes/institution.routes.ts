import { listInstitutionsSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { InstitutionDeps } from '../controllers/institution.controller.js';
import { createInstitutionController } from '../controllers/institution.controller.js';
import { validate } from '../middleware/validate.js';

export const institutionRoutes = (deps: InstitutionDeps): Router => {
  const router = Router();
  const controller = createInstitutionController(deps);

  router.get('/institutions', validate(listInstitutionsSchema), controller.list);

  return router;
};
