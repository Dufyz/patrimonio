import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import type { HealthCheckDeps } from '../controllers/health-check.controller.js';
import type { AssetDeps } from '../controllers/asset.controller.js';
import type { CategoryDeps } from '../controllers/category.controller.js';
import type { CorporateEventDeps } from '../controllers/corporate-event.controller.js';
import type { InstitutionDeps } from '../controllers/institution.controller.js';
import type { MarketDeps } from '../controllers/market.controller.js';
import type { PortfolioDeps } from '../controllers/portfolio.controller.js';
import type { TransactionDeps } from '../controllers/transaction.controller.js';
import { buildOpenApiDocument } from '../docs/openapi.js';
import { healthCheckRoutes } from './health-check.routes.js';
import { assetRoutes } from './asset.routes.js';
import { categoryRoutes } from './category.routes.js';
import { corporateEventRoutes } from './corporate-event.routes.js';
import { institutionRoutes } from './institution.routes.js';
import { marketRoutes } from './market.routes.js';
import { portfolioRoutes } from './portfolio.routes.js';
import { transactionRoutes } from './transaction.routes.js';

export type RouteDeps = HealthCheckDeps &
  PortfolioDeps &
  InstitutionDeps &
  CategoryDeps &
  AssetDeps &
  TransactionDeps &
  CorporateEventDeps &
  MarketDeps & { readonly version: string };

/** Tudo sob `/api`. */
export const apiRoutes = (deps: RouteDeps): Router => {
  const router = Router();
  const document = buildOpenApiDocument(deps.version);

  router.get('/docs.json', (_request, response) => {
    response.json(document);
  });
  router.use('/docs', swaggerUi.serve, swaggerUi.setup(document));

  router.use(healthCheckRoutes(deps));
  router.use(portfolioRoutes(deps));
  router.use(institutionRoutes(deps));
  router.use(categoryRoutes(deps));
  router.use(assetRoutes(deps));
  router.use(transactionRoutes(deps));
  router.use(corporateEventRoutes(deps));
  router.use(marketRoutes(deps));

  return router;
};
