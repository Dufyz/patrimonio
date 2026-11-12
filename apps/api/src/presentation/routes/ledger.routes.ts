import { createContributionSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { LedgerDeps } from '../controllers/ledger.controller.js';
import { createLedgerController } from '../controllers/ledger.controller.js';
import { validate } from '../middleware/validate.js';

/** O livro único: escritas que movem dinheiro e posição juntos. */
export const ledgerRoutes = (deps: LedgerDeps): Router => {
  const router = Router();
  const controller = createLedgerController(deps);

  router.post(
    '/ledger/aportes',
    validate(createContributionSchema),
    controller.contribute,
  );

  return router;
};
