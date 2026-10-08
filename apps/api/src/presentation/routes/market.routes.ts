import {
  getAssetPriceSeriesSchema,
  getMarketHealthSchema,
  refreshMarketSchema,
} from '@patrimonio/contracts';
import { Router } from 'express';

import type { MarketDeps } from '../controllers/market.controller.js';
import { createMarketController } from '../controllers/market.controller.js';
import { validate } from '../middleware/validate.js';

export const marketRoutes = (deps: MarketDeps): Router => {
  const router = Router();
  const controller = createMarketController(deps);

  router.get('/market/health', validate(getMarketHealthSchema), controller.health);
  router.post('/market/refresh', validate(refreshMarketSchema), controller.refresh);
  router.get(
    '/assets/:asset_id/prices',
    validate(getAssetPriceSeriesSchema),
    controller.priceSeries,
  );

  return router;
};
