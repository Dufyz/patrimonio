import type { getOverview } from '@patrimonio/application';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/**
 * A tela de abertura, numa rota só.
 *
 * Ela poderia ser cinco rotas — cabeçalho, evolução, composição, maiores
 * posições e pendências — e cada tela montada com cinco requisições paga cinco
 * vezes a ida até o banco, que está em outra rede. A tela é uma pergunta
 * ("quanto eu tenho hoje, e o que precisa de mim"), então a resposta é uma.
 */
export type OverviewDeps = {
  readonly usecases: {
    readonly getOverview: ReturnType<typeof getOverview>;
  };
};

export type OverviewController = {
  readonly overview: RequestHandler;
};

type OverviewQuery = {
  readonly portfolio_id: string;
  readonly on_date?: string;
  readonly from?: string;
  readonly to?: string;
};

export const createOverviewController = (deps: OverviewDeps): OverviewController => ({
  overview: async (request, response) => {
    const query = validatedQuery<OverviewQuery>(request);

    const result = await deps.usecases.getOverview({
      portfolio_id: String(query?.portfolio_id),
      ...(query?.on_date === undefined ? {} : { on_date: query.on_date }),
      ...(query?.from === undefined ? {} : { from: query.from }),
      ...(query?.to === undefined ? {} : { to: query.to }),
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json(result.value);
  },
});
