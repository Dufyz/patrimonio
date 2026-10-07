import { z } from 'zod';

/** `/api/health-check/live`: o processo está de pé. É o que o Traefik usa. */
export const liveResourceSchema = z.object({
  status: z.literal('ok'),
});

const dependencySchema = z.object({
  ok: z.boolean(),
  latency_ms: z.number().int().nonnegative(),
});

/**
 * `/api/health-check`: verifica Postgres e Redis separadamente e reporta a data
 * do último fechamento concluído. A api pode estar de pé com os jobs parados há
 * três dias, e a tela continuaria mostrando números — velhos.
 */
export const healthCheckResourceSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    database: dependencySchema,
    redis: dependencySchema,
  }),
  last_daily_close: z
    .object({
      reference_date: z.string().nullable(),
      completed_at: z.string(),
    })
    .nullable(),
  uptime_seconds: z.number().nonnegative(),
});

export type LiveResource = z.infer<typeof liveResourceSchema>;
export type HealthCheckResource = z.infer<typeof healthCheckResourceSchema>;
