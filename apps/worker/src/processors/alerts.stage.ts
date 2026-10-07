import { dedupeKey } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Worker } from 'bullmq';

import { defineStage } from '../infra/define-stage.js';
import type { StageDeps, StageJobData } from '../infra/define-stage.js';

/**
 * Fila declarada: concorrência, log, classificação de erro e marcação na outbox
 * já funcionam. O motor de alertas entra em E7 — até lá o estágio atravessa o
 * pipeline sem calcular nada, e é o que permite verificar o caminho
 * outbox → relay → fila → job de ponta a ponta.
 */
export const alertsStage = (deps: StageDeps): Worker<StageJobData> =>
  defineStage(
    {
      stage: 'alerts',
      run: async (job) => {
        deps.logger.warn(
          { stage: 'alerts', job_id: job.id },
          'estágio declarado sem implementação: o motor de alertas entra em E7',
        );

        return success(null);
      },
      scheduledEvent: (stageDeps) => ({
        stage: 'alerts',
        dedupe_key: dedupeKey.alerts(stageDeps.clock.today()),
        payload: { reference_date: stageDeps.clock.today() },
      }),
    },
    deps,
  );
