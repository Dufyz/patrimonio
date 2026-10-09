import type { listPositions } from '@patrimonio/application';
import type { ListPositionsQuery } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/**
 * T-02 · Posições.
 *
 * Uma rota só, porque a tela é uma pergunta só: o que está em carteira hoje. O
 * recorte — carteira, agrupamento, busca e categoria — vem na query, que é a
 * mesma coisa que a URL da tela carrega: colar o endereço em outra aba
 * reproduz exatamente o que estava na tela.
 *
 * A data de hoje é do caso de uso, que recebe o relógio por dependência: o
 * controller não sabe que dia é hoje, e é o que torna o teste determinístico.
 */
export type PositionDeps = {
  readonly usecases: { readonly listPositions: ReturnType<typeof listPositions> };
};

export type PositionController = { readonly list: RequestHandler };

export const createPositionController = (deps: PositionDeps): PositionController => ({
  list: async (request, response) => {
    const query = validatedQuery<ListPositionsQuery>(request);

    const result = await deps.usecases.listPositions({
      portfolioId: query.portfolio_id ?? null,
      groupBy: query.group_by,
      search: query.search === undefined || query.search === '' ? null : query.search,
      categoryId: query.category_id ?? null,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json(result.value);
  },
});
