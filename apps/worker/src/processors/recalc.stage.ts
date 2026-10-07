import { BadRequestError } from '@patrimonio/application';
import { isDateOnly } from '@patrimonio/domain';
import { failure } from '@patrimonio/shared';
import type { Worker } from 'bullmq';

import { defineStage } from '../infra/define-stage.js';
import type { StageDeps, StageJobData } from '../infra/define-stage.js';

/**
 * O recálculo de uma carteira a partir de uma data. A concorrência da fila é 1 de
 * propósito: a trava por carteira já serializa, e paralelismo aqui só produziria
 * espera.
 *
 * O payload chega da outbox e vem do jsonb: ele é conferido antes de virar
 * parâmetro, porque um `from_date` inválido reescreveria o intervalo errado — e
 * reescrever o intervalo errado não dá erro, dá número errado.
 */
export const recalcStage = (deps: StageDeps): Worker<StageJobData> =>
  defineStage(
    {
      stage: 'recalc',
      run: async (job) => {
        const portfolioId = job.data['portfolio_id'];
        const fromDate = job.data['from_date'];

        if (typeof portfolioId !== 'string' || !isDateOnly(fromDate)) {
          return failure(
            new BadRequestError(
              'O pedido de recálculo precisa de portfolio_id e from_date',
            ),
          );
        }

        return deps.usecases.recalculatePortfolio({
          portfolio_id: portfolioId,
          from_date: fromDate,
          ...(typeof job.data.origin_request_id === 'string'
            ? { origin_request_id: job.data.origin_request_id }
            : {}),
        });
      },
    },
    deps,
  );
