import { z } from 'zod';

/**
 * Fonte única das variáveis de ambiente. Nenhum outro arquivo do monorepo lê
 * `process.env`: o ESLint recusa, e a regra de camada impede que `apps/web`
 * importe este pacote.
 *
 * A validação acontece uma vez, no boot. Variável faltando ou inválida derruba
 * o processo nomeando qual, em vez de falhar na primeira requisição que
 * precisar dela.
 */

const port = z.coerce.number().int().positive().max(65_535);
const positiveInt = z.coerce.number().int().positive();

const schema = z
  .object({
    // ─── Servidor ───────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    API_PORT: port.default(3333),
    // Exatamente uma origem: CORS permissivo com credenciais é falha de
    // segurança, não conveniência.
    WEB_ORIGIN: z.string().url(),

    // ─── Banco ──────────────────────────────────────────────────────────────
    DB_CONNECTION: z.string().min(1),
    DB_TEST_CONNECTION: z.string().min(1).optional(),
    DB_POOL_API: positiveInt.default(10),
    DB_POOL_WORKER: positiveInt.default(4),

    // ─── Redis ──────────────────────────────────────────────────────────────
    REDIS_URL: z.string().min(1),
    REDIS_TEST_URL: z.string().min(1).optional(),

    // ─── Pipeline ───────────────────────────────────────────────────────────
    RELAY_POLL_MS: positiveInt.default(1_000),
    RELAY_BATCH_SIZE: positiveInt.default(50),
    DEBOUNCE_MAX_MS: positiveInt.default(15_000),

    // ─── Mercado ────────────────────────────────────────────────────────────
    MARKET_BRAPI_TOKEN: z.string().optional(),
    MARKET_REQUEST_TIMEOUT_MS: positiveInt.default(10_000),
    PRICE_STALE_AFTER_DAYS: positiveInt.default(3),

    // ─── Backup ─────────────────────────────────────────────────────────────
    BACKUP_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // Chave pública do age. A privada fica no gerenciador de senhas: se a VPS
    // e o Storage forem comprometidos, o atacante leva dumps cifrados.
    BACKUP_PUBLIC_KEY: z.string().optional(),
    BACKUP_BUCKET: z.string().default('backups'),
    BACKUP_STORAGE_URL: z.string().url().optional(),
    BACKUP_STORAGE_TOKEN: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.BACKUP_ENABLED) return;

    // Backup ligado sem destino ou sem chave é backup que não existe, e
    // descobrir isso às 3h da manhã não serve para nada.
    for (const key of [
      'BACKUP_PUBLIC_KEY',
      'BACKUP_STORAGE_URL',
      'BACKUP_STORAGE_TOKEN',
    ] as const) {
      if (value[key] === undefined || value[key] === '') {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'obrigatória quando BACKUP_ENABLED=true',
        });
      }
    }
  });

type Raw = z.infer<typeof schema>;

export type Environment = {
  readonly server: {
    readonly nodeEnv: Raw['NODE_ENV'];
    readonly logLevel: Raw['LOG_LEVEL'];
    readonly apiPort: number;
    readonly webOrigin: string;
    readonly isProduction: boolean;
    readonly isTest: boolean;
  };
  readonly database: {
    readonly connection: string;
    readonly testConnection: string | undefined;
    readonly poolApi: number;
    readonly poolWorker: number;
  };
  readonly redis: {
    readonly url: string;
    readonly testUrl: string | undefined;
  };
  readonly pipeline: {
    readonly relayPollMs: number;
    readonly relayBatchSize: number;
    readonly debounceMaxMs: number;
  };
  readonly market: {
    readonly brapiToken: string | undefined;
    readonly requestTimeoutMs: number;
    readonly priceStaleAfterDays: number;
  };
  readonly backup: {
    readonly enabled: boolean;
    readonly publicKey: string | undefined;
    readonly bucket: string;
    readonly storageUrl: string | undefined;
    readonly storageToken: string | undefined;
  };
};

export class EnvironmentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Ambiente inválido:\n${problems.map((p) => `  · ${p}`).join('\n')}`);
    this.name = 'EnvironmentError';
  }
}

const group = (raw: Raw): Environment => ({
  server: {
    nodeEnv: raw.NODE_ENV,
    logLevel: raw.LOG_LEVEL,
    apiPort: raw.API_PORT,
    webOrigin: raw.WEB_ORIGIN,
    isProduction: raw.NODE_ENV === 'production',
    isTest: raw.NODE_ENV === 'test',
  },
  database: {
    connection: raw.DB_CONNECTION,
    testConnection: raw.DB_TEST_CONNECTION,
    poolApi: raw.DB_POOL_API,
    poolWorker: raw.DB_POOL_WORKER,
  },
  redis: {
    url: raw.REDIS_URL,
    testUrl: raw.REDIS_TEST_URL,
  },
  pipeline: {
    relayPollMs: raw.RELAY_POLL_MS,
    relayBatchSize: raw.RELAY_BATCH_SIZE,
    debounceMaxMs: raw.DEBOUNCE_MAX_MS,
  },
  market: {
    brapiToken: raw.MARKET_BRAPI_TOKEN,
    requestTimeoutMs: raw.MARKET_REQUEST_TIMEOUT_MS,
    priceStaleAfterDays: raw.PRICE_STALE_AFTER_DAYS,
  },
  backup: {
    enabled: raw.BACKUP_ENABLED,
    publicKey: raw.BACKUP_PUBLIC_KEY,
    bucket: raw.BACKUP_BUCKET,
    storageUrl: raw.BACKUP_STORAGE_URL,
    storageToken: raw.BACKUP_STORAGE_TOKEN,
  },
});

/**
 * Num arquivo `.env`, `CHAVE=` significa "não definida", não "string vazia" — e
 * tratar as duas como a mesma coisa é o que faria o boot reclamar de uma
 * variável opcional que ninguém preencheu.
 */
const withoutEmpty = (
  source: Record<string, string | undefined>,
): Record<string, string | undefined> =>
  Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );

/** Valida e agrupa. Lança `EnvironmentError` nomeando cada variável culpada. */
export const loadEnvironment = (
  source: Record<string, string | undefined>,
): Environment => {
  const parsed = schema.safeParse(withoutEmpty(source));

  if (!parsed.success) {
    throw new EnvironmentError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`,
      ),
    );
  }

  return group(parsed.data);
};
