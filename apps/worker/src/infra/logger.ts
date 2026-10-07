import { environment } from '@patrimonio/env';
import { scrubLogRecord } from '@patrimonio/shared';
import { pino } from 'pino';
import type { Logger } from 'pino';

/**
 * Mesmo formato do log da api, com `service: worker`. Todo job registra
 * `jobId`, e o `origin_request_id` que veio do evento liga o job ao clique que
 * o pediu.
 */
export const logger: Logger = pino({
  level: environment.server.logLevel,
  base: { service: 'worker' },
  formatters: {
    level: (label) => ({ level: label }),
    log: (record) => scrubLogRecord(record) as Record<string, unknown>,
  },
  ...(environment.server.isProduction
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }),
});
