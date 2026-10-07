import {
  archiveAssetSchema,
  createAssetSchema,
  deleteAssetSchema,
  getAssetSchema,
  listAssetsSchema,
  updateAssetSchema,
} from '@patrimonio/contracts';
import { Router } from 'express';

import type { AssetDeps } from '../controllers/asset.controller.js';
import { createAssetController } from '../controllers/asset.controller.js';
import { validate } from '../middleware/validate.js';

export const assetRoutes = (deps: AssetDeps): Router => {
  const router = Router();
  const controller = createAssetController(deps);

  router.get('/assets', validate(listAssetsSchema), controller.list);
  router.post('/assets', validate(createAssetSchema), controller.create);
  router.get('/assets/:asset_id', validate(getAssetSchema), controller.detail);
  router.patch('/assets/:asset_id', validate(updateAssetSchema), controller.update);
  router.post(
    '/assets/:asset_id/archive',
    validate(archiveAssetSchema),
    controller.archive,
  );
  router.delete('/assets/:asset_id', validate(deleteAssetSchema), controller.remove);

  return router;
};
