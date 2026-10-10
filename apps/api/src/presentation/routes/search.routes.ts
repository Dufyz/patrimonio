import { getSearchSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { SearchDeps } from '../controllers/search.controller.js';
import { createSearchController } from '../controllers/search.controller.js';
import { validate } from '../middleware/validate.js';

/**
 * T-09 · A busca global.
 *
 * Em arquivo próprio: ela atravessa ativo e lançamento, e não pertence a
 * nenhum dos dois recursos. `GET /assets` e `GET /transactions` continuam
 * sendo as listagens; esta é a leitura da paleta.
 */
export const searchRoutes = (deps: SearchDeps): Router => {
  const router = Router();
  const controller = createSearchController(deps);

  router.get('/search', validate(getSearchSchema), controller.find);

  return router;
};
