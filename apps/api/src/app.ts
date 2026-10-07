import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { environment } from '@patrimonio/env';
import type { Queues } from '@patrimonio/queue';
import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { logger } from './infra/config/logger.js';
import {
  errorHandler,
  notFoundHandler,
} from './presentation/middleware/error-handler.js';
import { requestContext } from './presentation/middleware/request-context.js';
import { apiRoutes } from './presentation/routes/index.js';
import type { RouteDeps } from './presentation/routes/index.js';

export type AppDeps = RouteDeps & {
  /** Só para montar o Bull Board: o caminho de negócio passa pela outbox. */
  readonly queues?: Queues;
};

const HEALTH_PATHS = new Set(['/api/health-check', '/api/health-check/live']);

export const createApp = (deps: AppDeps): Express => {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(requestContext);

  app.use(
    pinoHttp({
      logger,
      genReqId: (request) => request.id ?? 'sem-id',
      customProps: (request) => ({
        requestId: (request as { requestId?: string }).requestId,
      }),
      // O log do healthcheck não polui o stdout: ele bate a cada 5 minutos.
      autoLogging: {
        ignore: (request) => HEALTH_PATHS.has(request.url ?? ''),
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // O Swagger UI injeta estilo próprio; o resto fica fechado.
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
    }),
  );

  // Exatamente uma origem permitida, vinda de packages/env. CORS permissivo
  // com credenciais é falha de segurança, não conveniência.
  app.use(
    cors({
      origin: [environment.server.webOrigin],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  if (deps.queues !== undefined) {
    const adapter = new ExpressAdapter();
    adapter.setBasePath('/api/queues');
    createBullBoard({
      queues: Object.values(deps.queues).map((queue) => new BullMQAdapter(queue)),
      serverAdapter: adapter,
    });
    app.use('/api/queues', adapter.getRouter());
  }

  app.use('/api', apiRoutes(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
