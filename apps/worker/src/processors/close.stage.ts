import { dedupeKey } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Worker } from 'bullmq';

import { defineStage } from '../infra/define-stage.js';
import type { StageDeps, StageJobData } from '../infra/define-stage.js';

/**
 * Fila declarada: concorrência, log, classificação de erro e marcação na outbox
 * já funcionam. O fechamento diário entra em E3 — até lá o estágio atravessa o
 * pipeline sem calcular nada, e é o que permite verificar o caminho
 * outbox → relay → fila → job de ponta a ponta.
 */
export const closeStage = (deps: StageDeps): Worker<StageJobData> =>
  defineStage(
    {
      stage: 'close',
      run: async (job) => {
        deps.logger.warn(
          { stage: 'close', job_id: job.id },
          'estágio declarado sem implementação: o fechamento diário entra em E3',
        );

        return success(null);
      },
      scheduledEvent: (stageDeps) => ({
        stage: 'close',
        dedupe_key: dedupeKey.close(stageDeps.clock.today()),
        payload: { reference_date: stageDeps.clock.today() },
      }),
    },
    deps,
  );
