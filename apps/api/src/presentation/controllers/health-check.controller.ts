import type { OutboxRepository } from '@patrimonio/application';
import type { HealthCheckResource, LiveResource } from '@patrimonio/contracts';
import type { Sql } from '@patrimonio/db';
import { pingDatabase } from '@patrimonio/db';
import { pingRedis } from '@patrimonio/queue';
import type { RedisConnection } from '@patrimonio/queue';
import type { RequestHandler } from 'express';

export type HealthCheckDeps = {
  readonly sql: Sql;
  readonly redis: RedisConnection;
  readonly outbox: OutboxRepository;
  readonly startedAt: Date;
};

const timed = async (check: () => Promise<boolean>) => {
  const started = process.hrtime.bigint();
  const ok = await check();
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;

  return { ok, latency_ms: Math.round(elapsed) };
};

export type HealthCheckController = {
  readonly live: RequestHandler;
  readonly deep: RequestHandler;
};

export const createHealthCheckController = (
  deps: HealthCheckDeps,
): HealthCheckController => ({
  /** Só diz que o processo está vivo. É o que o Traefik usa. */
  live: (_request, response) => {
    const body: LiveResource = { status: 'ok' };
    response.status(200).json(body);
  },

  /**
   * Verifica Postgres e Redis separadamente e reporta a data do último
   * fechamento concluído: a api pode estar de pé com os jobs parados há três
   * dias, e a tela continuaria mostrando números velhos.
   */
  deep: async (_request, response) => {
    const [database, redis, lastClose] = await Promise.all([
      timed(() => pingDatabase(deps.sql)),
      timed(() => pingRedis(deps.redis)),
      deps.outbox.lastCompletedExecution('close'),
    ]);

    const healthy = database.ok && redis.ok && lastClose.isSuccess();

    const body: HealthCheckResource = {
      status: healthy ? 'ok' : 'degraded',
      checks: { database, redis },
      last_daily_close:
        lastClose.isSuccess() && lastClose.value !== null
          ? {
              reference_date: lastClose.value.reference_date,
              completed_at: lastClose.value.completed_at,
            }
          : null,
      uptime_seconds: Math.round((Date.now() - deps.startedAt.getTime()) / 1_000),
    };

    response.status(healthy ? 200 : 503).json(body);
  },
});
