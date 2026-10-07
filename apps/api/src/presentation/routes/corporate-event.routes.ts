import {
  confirmCorporateEventSchema,
  listCorporateEventsSchema,
  registerCorporateEventSchema,
} from '@patrimonio/contracts';
import { Router } from 'express';

import type { CorporateEventDeps } from '../controllers/corporate-event.controller.js';
import { createCorporateEventController } from '../controllers/corporate-event.controller.js';
import { validate } from '../middleware/validate.js';

export const corporateEventRoutes = (deps: CorporateEventDeps): Router => {
  const router = Router();
  const controller = createCorporateEventController(deps);

  router.get('/corporate-events', validate(listCorporateEventsSchema), controller.list);
  router.post(
    '/corporate-events',
    validate(registerCorporateEventSchema),
    controller.register,
  );
  router.post(
    '/corporate-events/:event_id/confirm',
    validate(confirmCorporateEventSchema),
    controller.confirm,
  );

  return router;
};
