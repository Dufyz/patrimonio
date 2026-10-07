import {
  archivePortfolioSchema,
  createPortfolioSchema,
  deletePortfolioSchema,
  getPortfolioSchema,
  getStrategySchema,
  listPortfoliosSchema,
  putStrategySchema,
  updatePortfolioSchema,
} from '@patrimonio/contracts';
import { Router } from 'express';

import type { PortfolioDeps } from '../controllers/portfolio.controller.js';
import { createPortfolioController } from '../controllers/portfolio.controller.js';
import { validate } from '../middleware/validate.js';

export const portfolioRoutes = (deps: PortfolioDeps): Router => {
  const router = Router();
  const controller = createPortfolioController(deps);

  router.get('/portfolios', validate(listPortfoliosSchema), controller.list);
  router.post('/portfolios', validate(createPortfolioSchema), controller.create);
  router.get(
    '/portfolios/:portfolio_id',
    validate(getPortfolioSchema),
    controller.detail,
  );
  router.patch(
    '/portfolios/:portfolio_id',
    validate(updatePortfolioSchema),
    controller.update,
  );
  router.post(
    '/portfolios/:portfolio_id/archive',
    validate(archivePortfolioSchema),
    controller.archive,
  );
  router.delete(
    '/portfolios/:portfolio_id',
    validate(deletePortfolioSchema),
    controller.remove,
  );
  router.get(
    '/portfolios/:portfolio_id/strategy',
    validate(getStrategySchema),
    controller.getStrategy,
  );
  router.put(
    '/portfolios/:portfolio_id/strategy',
    validate(putStrategySchema),
    controller.putStrategy,
  );

  return router;
};
