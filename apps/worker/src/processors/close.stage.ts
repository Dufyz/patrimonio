import { dedupeKey, isDateOnly } from '@patrimonio/domain';
import type { Worker } from 'bullmq';

import { defineStage } from '../infra/define-stage.js';
import type { StageDeps, StageJobData } from '../infra/define-stage.js';

/**
 * O fechamento do dia, para todas as carteiras. Ou o dia fecha inteiro, ou nada é
 * gravado: cada carteira fecha na sua transação, e o estágio só termina bem quando
 * todas terminaram.
 *
 * Reexecutar o fechamento do mesmo dia produz exatamente as mesmas linhas — é um
 * `UPSERT` sobre a chave `(portfolio_id, position_date)`, e o cálculo é função do
 * livro, não do momento em que rodou.
 */
export const closeStage = (deps: StageDeps): Worker<StageJobData> =>
  defineStage(
    {
      stage: 'close',
      run: async (job) => {
        const reference = job.data['reference_date'];

        return deps.usecases.closeDay(
          isDateOnly(reference) ? { reference_date: reference } : {},
        );
      },
      scheduledEvent: (stageDeps) => ({
        stage: 'close',
        dedupe_key: dedupeKey.close(stageDeps.clock.today()),
        payload: { reference_date: stageDeps.clock.today() },
      }),
    },
    deps,
  );
