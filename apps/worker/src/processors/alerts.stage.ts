import { dedupeKey, isDateOnly } from '@patrimonio/domain';
import type { Worker } from 'bullmq';

import { defineStage } from '../infra/define-stage.js';
import type { StageDeps, StageJobData } from '../infra/define-stage.js';

/**
 * A reconciliação dos alertas, que roda no fechamento do dia e grava o resultado —
 * a tela de Requer atenção só lê. As treze regras entram em E7; o que já está de
 * pé é o motor que as executa e, principalmente, a garantia de que o estado que o
 * usuário mexeu sobrevive: adiado continua adiado, ignorado não volta.
 *
 * Regra sem executor declarado não é reconciliada, e é o que permite ligar as
 * treze uma a uma sem que as ainda não escritas apaguem o que já existe.
 */
export const alertsStage = (deps: StageDeps): Worker<StageJobData> =>
  defineStage(
    {
      stage: 'alerts',
      run: async (job) => {
        const reference = job.data['reference_date'];

        return deps.usecases.reconcileAlerts(
          isDateOnly(reference) ? { reference_date: reference } : {},
        );
      },
      scheduledEvent: (stageDeps) => ({
        stage: 'alerts',
        dedupe_key: dedupeKey.alerts(stageDeps.clock.today()),
        payload: { reference_date: stageDeps.clock.today() },
      }),
    },
    deps,
  );
