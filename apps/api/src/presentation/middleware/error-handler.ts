import { isAppError } from '@patrimonio/application';
import { environment } from '@patrimonio/env';
import type { ErrorRequestHandler, RequestHandler } from 'express';

import { logger } from '../../infra/config/logger.js';

/**
 * Rede de segurança, não caminho normal: a falha esperada volta como `Either` e
 * o controller a traduz. O que chega aqui é o inesperado.
 */
export type ErrorHandlerOptions = {
  /** Stack nunca vai no corpo em produção; em desenvolvimento ajuda. */
  readonly includeStack: boolean;
};

export const createErrorHandler =
  (options: ErrorHandlerOptions): ErrorRequestHandler =>
  (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const requestId = request.requestId;

    if (isAppError(error)) {
      logger.warn(
        { requestId, statusCode: error.statusCode, route: request.path },
        error.message,
      );
      response
        .status(error.statusCode)
        .json({ message: error.message, request_id: requestId });
      return;
    }

    const stack = error instanceof Error ? error.stack : undefined;
    logger.error({ requestId, route: request.path, err: stack }, 'erro inesperado');

    response.status(500).json({
      message: 'Erro interno',
      request_id: requestId,
      ...(options.includeStack ? { stack } : {}),
    });
  };

export const errorHandler: ErrorRequestHandler = createErrorHandler({
  includeStack: !environment.server.isProduction,
});

/** 404 nomeando método e caminho: economiza um "mas eu chamei certo". */
export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    message: `Rota não encontrada: ${request.method} ${request.originalUrl}`,
    request_id: request.requestId,
  });
};
