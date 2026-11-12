import { dedupeKey } from '@patrimonio/domain';
import type { Worker } from 'bullmq';

import { defineStage } from '../infra/define-stage.js';
import type { StageDeps, StageJobData } from '../infra/define-stage.js';

/**
 * 00:05 (São Paulo): gera os previstos do mês dos recorrentes, lança os
 * automáticos cuja data chegou e credita os benefícios do dia. É a mesma função
 * que a API expõe em `/finance/jobs/sync`, e é idempotente: índices únicos no
 * banco impedem previsto duplicado por (recorrente, mês) e crédito duplicado por
 * (conta, mês), então reexecutar não muda nada.
 */
export const financeStage = (deps: StageDeps): Worker<StageJobData> =>
  defineStage(
    {
      stage: 'finance',
      run: async () => deps.usecases.syncFinance(),
      scheduledEvent: (stageDeps) => ({
        stage: 'finance',
        dedupe_key: dedupeKey.finance(stageDeps.clock.today()),
        payload: { reference_date: stageDeps.clock.today() },
      }),
    },
    deps,
  );
