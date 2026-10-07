import { AsyncLocalStorage } from 'node:async_hooks';

import { environment } from '@patrimonio/env';
import { scrubLogRecord } from '@patrimonio/shared';
import { pino } from 'pino';
import type { Logger } from 'pino';

/**
 * `pino` em JSON para stdout. O nível vem de `env`, e o registro passa pelo
 * scrub antes de sair: valor monetário, quantidade e nome de ativo não entram
 * no log.
 */
export const logger: Logger = pino({
  level: environment.server.logLevel,
  base: { service: 'api' },
  formatters: {
    level: (label) => ({ level: label }),
    log: (record) => scrubLogRecord(record) as Record<string, unknown>,
  },
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization'],
    censor: '[redigido]',
  },
  ...(environment.server.isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }),
});

export type RequestContext = { readonly requestId: string };

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, work: () => T): T =>
  storage.run(context, work);

export const currentRequestId = (): string | undefined => storage.getStore()?.requestId;

/**
 * O logger do request. Todo caso de uso que registra algo usa este, e por isso
 * cada linha sai com o `requestId` — é o que liga o clique à consulta.
 */
export const contextLogger = (): Logger => {
  const requestId = currentRequestId();

  return requestId === undefined ? logger : logger.child({ requestId });
};
