import { getAssetPageSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { AssetPageDeps } from '../controllers/asset-page.controller.js';
import { createAssetPageController } from '../controllers/asset-page.controller.js';
import { validate } from '../middleware/validate.js';

/**
 * T-03 · A página do ativo.
 *
 * Em arquivo próprio, e não dentro de `asset.routes.ts`, porque ela é leitura
 * de tela e não cadastro: a montagem é a de Posições — um recurso que a `api`
 * entrega pronto —, e misturá-la com o CRUD do ativo juntaria dois assuntos
 * que mudam por razões diferentes.
 */
export const assetPageRoutes = (deps: AssetPageDeps): Router => {
  const router = Router();
  const controller = createAssetPageController(deps);

  router.get('/assets/:asset_id/page', validate(getAssetPageSchema), controller.page);

  return router;
};
