import { environment } from '@patrimonio/env';
import { registerSchedules } from '@patrimonio/queue';

import { createContainer } from '../container.js';
import { logger } from '../infra/logger.js';
import { startRelay } from '../infra/relay.js';
import type { StageDeps } from '../infra/define-stage.js';
import {
  backupStage,
  closeStage,
  importStage,
  marketStage,
  recalcStage,
} from '../processors/index.js';
import { incrementalSyncEvent } from '../processors/market.stage.js';

const container = createContainer();

const deps: StageDeps = {
  connection: container.redis,
  unitOfWork: container.unitOfWork,
  outbox: container.repositories.outbox,
  clock: container.clock,
  logger,
  usecases: container.usecases,
};

// Os cinco estágios. Nenhum processor instancia dependência: recebe o container.
const workers = [
  recalcStage(deps),
  marketStage(deps),
  closeStage(deps),
  importStage(deps),
  backupStage(deps),
];

const scheduled = await registerSchedules(container.queues);
logger.info({ scheduled }, 'jobs repetíveis registrados');

// Retomada: uma máquina desligada às 09:00 não pode deixar buraco. Ao subir, o
// worker pede a sincronização incremental do D-1, que preenche os dias úteis que
// faltam. O pedido vai pela outbox, como o do agendamento; falha só vira aviso.
try {
  const enqueued = await container.repositories.outbox.enqueue([
    await incrementalSyncEvent(deps),
  ]);

  if (enqueued.isFailure()) {
    logger.warn({ err: enqueued.value.message }, 'retomada não foi enfileirada');
  } else {
    logger.info('sincronização incremental pedida na subida');
  }
} catch (error) {
  logger.warn({ err: String(error) }, 'retomada não foi pedida');
}

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
