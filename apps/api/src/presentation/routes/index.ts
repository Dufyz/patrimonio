import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import type { HealthCheckDeps } from '../controllers/health-check.controller.js';
import type { PortfolioDeps } from '../controllers/portfolio.controller.js';
import { buildOpenApiDocument } from '../docs/openapi.js';
import { healthCheckRoutes } from './health-check.routes.js';
import { portfolioRoutes } from './portfolio.routes.js';

export type RouteDeps = HealthCheckDeps & PortfolioDeps & { readonly version: string };

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

  return router;
};
