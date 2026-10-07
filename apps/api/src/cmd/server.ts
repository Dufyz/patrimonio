import { runMigrations } from '@patrimonio/db';
import { environment } from '@patrimonio/env';

import { createApp } from '../app.js';
import { createContainer } from '../container.js';
import { logger } from '../infra/config/logger.js';

const VERSION = '0.1.0';

const container = createContainer(VERSION);

/**
 * A migration roda antes de abrir a porta. Se ela falhar, o processo morre, o
 * healthcheck não fica verde e o orquestrador não troca o tráfego: é um deploy
 * que falhou, não uma produção quebrada.
 */
const { applied } = await runMigrations(environment.database.connection, {
  log: (line) => logger.info({ migration: line }, 'migration'),
});

if (applied.length > 0) logger.info({ applied }, 'schema atualizado');

const app = createApp({
  sql: container.sql,
  redis: container.redis,
  outbox: container.repositories.outbox,
  queues: container.queues,
  startedAt: container.startedAt,
  version: container.version,
});

const server = app.listen(environment.server.apiPort, () => {
  logger.info(
    { port: environment.server.apiPort, env: environment.server.nodeEnv },
    'api de pé',
  );
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'encerrando');

  server.close(async () => {
    await container.shutdown();
    process.exit(0);
  });

  // Se alguma conexão pendurar, não fica eternamente de pé.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
