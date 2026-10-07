import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import { runWithRequestContext } from '../../infra/config/logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Todo request recebe um `requestId`, que vai no cabeçalho da resposta, em cada
 * linha de log e — quando o request pede trabalho ao pipeline — no evento da
 * outbox, de onde o job o carrega até o fim.
 */
export const requestContext: RequestHandler = (request, response, next) => {
  const incoming = request.header(REQUEST_ID_HEADER);
  const requestId = incoming !== undefined && incoming !== '' ? incoming : randomUUID();

  request.requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  runWithRequestContext({ requestId }, () => {
    next();
  });
};
