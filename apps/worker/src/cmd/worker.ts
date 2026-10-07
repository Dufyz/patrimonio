import { environment } from '@patrimonio/env';
import { registerSchedules } from '@patrimonio/queue';

import { createContainer } from '../container.js';
import { logger } from '../infra/logger.js';
import { startRelay } from '../infra/relay.js';
import type { StageDeps } from '../infra/define-stage.js';
import {
  alertsStage,
  backupStage,
  closeStage,
  importStage,
  marketStage,
  recalcStage,
} from '../processors/index.js';

const container = createContainer();

const deps: StageDeps = {
  connection: container.redis,
  unitOfWork: container.unitOfWork,
  outbox: container.repositories.outbox,
  clock: container.clock,
  logger,
};

// Os seis estágios. Nenhum processor instancia dependência: recebe o container.
const workers = [
  recalcStage(deps),
  marketStage(deps),
  closeStage(deps),
  alertsStage(deps),
  importStage(deps),
  backupStage(deps),
];

const scheduled = await registerSchedules(container.queues);
logger.info({ scheduled }, 'jobs repetíveis registrados');

const relay = startRelay({
  unitOfWork: container.unitOfWork,
  queues: container.queues,
  logger,
  pollMs: environment.pipeline.relayPollMs,
  batchSize: environment.pipeline.relayBatchSize,
});

logger.info(
  { queues: workers.length, poll_ms: environment.pipeline.relayPollMs },
  'worker de pé',
);

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'encerrando');
  relay.stop();

  // Fecha os workers primeiro: job em andamento termina antes de o banco cair.
  await Promise.all(workers.map((worker) => worker.close()));
  await container.shutdown();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
