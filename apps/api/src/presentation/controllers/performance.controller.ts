import type { getPerformance } from '@patrimonio/application';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/**
 * A tela de Desempenho, numa rota só. Ela é uma pergunta — quanto do
 * crescimento veio de aporte e quanto veio de rentabilidade — e as quatro
 * tabelas e o gráfico respondem a ela em conjunto, sobre o mesmo fechamento e a
 * mesma cota. Cinco rotas deixariam cada uma escolher o seu "hoje".
 */
export type PerformanceDeps = {
  readonly usecases: {
    readonly getPerformance: ReturnType<typeof getPerformance>;
  };
};

export type PerformanceController = {
  readonly performance: RequestHandler;
};

type PerformanceQuery = {
  readonly portfolio_id?: string;
  readonly on_date?: string;
  readonly from?: string;
  readonly to?: string;
  readonly benchmark_ids?: string;
};

export const createPerformanceController = (
  deps: PerformanceDeps,
): PerformanceController => ({
  performance: async (request, response) => {
    const query = validatedQuery<PerformanceQuery>(request);

    const benchmarkIds =
      query?.benchmark_ids === undefined || query.benchmark_ids === ''
        ? []
        : query.benchmark_ids.split(',');

    const result = await deps.usecases.getPerformance({
      // A carteira é filtro, não rota: a ausência do parâmetro é o consolidado.
      portfolio_id: query?.portfolio_id ?? null,
      ...(query?.on_date === undefined ? {} : { on_date: query.on_date }),
      ...(query?.from === undefined ? {} : { from: query.from }),
      ...(query?.to === undefined ? {} : { to: query.to }),
      benchmark_ids: benchmarkIds,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json(result.value);
  },
});
