import { dedupeKey } from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Worker } from 'bullmq';

import { defineStage } from '../infra/define-stage.js';
import type { StageDeps, StageJobData } from '../infra/define-stage.js';

/**
 * Fila declarada: concorrência, log, classificação de erro e marcação na outbox
 * já funcionam. A ingestão de dados de mercado entra em E4 — até lá o estágio atravessa o
 * pipeline sem calcular nada, e é o que permite verificar o caminho
 * outbox → relay → fila → job de ponta a ponta.
 */
export const marketStage = (deps: StageDeps): Worker<StageJobData> =>
  defineStage(
    {
      stage: 'market',
      run: async (job) => {
        deps.logger.warn(
          { stage: 'market', job_id: job.id },
          'estágio declarado sem implementação: a ingestão de dados de mercado entra em E4',
        );

        return success(null);
      },
      scheduledEvent: (stageDeps) => ({
        stage: 'market',
        dedupe_key: dedupeKey.market(stageDeps.clock.today()),
        payload: { reference_date: stageDeps.clock.today() },
      }),
    },
    deps,
  );
