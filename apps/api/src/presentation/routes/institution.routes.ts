import {
  createInstitutionSchema,
  deleteInstitutionSchema,
  getFgcExposureSchema,
  listInstitutionsSchema,
  updateInstitutionSchema,
} from '@patrimonio/contracts';
import { Router } from 'express';

import type { InstitutionDeps } from '../controllers/institution.controller.js';
import { createInstitutionController } from '../controllers/institution.controller.js';
import { validate } from '../middleware/validate.js';

export const institutionRoutes = (deps: InstitutionDeps): Router => {
  const router = Router();
  const controller = createInstitutionController(deps);

  router.get('/institutions', validate(listInstitutionsSchema), controller.list);
  router.post('/institutions', validate(createInstitutionSchema), controller.create);
  router.patch(
    '/institutions/:institution_id',
    validate(updateInstitutionSchema),
    controller.update,
  );
  router.delete(
    '/institutions/:institution_id',
    validate(deleteInstitutionSchema),
    controller.remove,
  );
  router.get(
    '/institutions/:institution_id/fgc-exposure',
    validate(getFgcExposureSchema),
    controller.fgcExposure,
  );

  return router;
};
