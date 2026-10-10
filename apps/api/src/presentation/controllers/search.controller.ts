import type { searchGlobal } from '@patrimonio/application';
import type { GetSearchQuery } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/**
 * T-09 · A busca global.
 *
 * Uma rota só, e leitura. O texto e a carteira vêm na query; o controller não
 * procura nem ordena — o que está em cada grupo, e em qual ordem, chega pronto
 * do repositório. A paleta decide só qual *grupo* aparece primeiro.
 */
export type SearchDeps = {
  readonly usecases: { readonly searchGlobal: ReturnType<typeof searchGlobal> };
};

export type SearchController = { readonly find: RequestHandler };

export const createSearchController = (deps: SearchDeps): SearchController => ({
  find: async (request, response) => {
    const query = validatedQuery<GetSearchQuery>(request);

    const result = await deps.usecases.searchGlobal({
      text: query.q,
      portfolioId: query.portfolio_id ?? null,
      limit: query.limit,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json(result.value);
  },
});
