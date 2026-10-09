import type { getAllocation } from '@patrimonio/application';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/**
 * A tela de Estratégia, numa rota só. Ela é uma pergunta — o dinheiro está
 * dividido como eu disse que queria? — e a tabela, o desvio e a sugestão de
 * aporte respondem a ela sobre o mesmo fechamento. A escrita do alvo continua em
 * `PUT /portfolios/{id}/strategy`: ler a estratégia e declará-la são operações
 * diferentes, e a leitura da tela carrega muito mais do que o alvo.
 */
export type AllocationDeps = {
  readonly usecases: {
    readonly getAllocation: ReturnType<typeof getAllocation>;
  };
};

export type AllocationController = {
  readonly allocation: RequestHandler;
};

type AllocationQuery = {
  readonly portfolio_id: string;
  readonly on_date?: string;
  readonly contribution?: string;
};

export const createAllocationController = (
  deps: AllocationDeps,
): AllocationController => ({
  allocation: async (request, response) => {
    const query = validatedQuery<AllocationQuery>(request);

    const result = await deps.usecases.getAllocation({
      portfolio_id: String(query?.portfolio_id),
      ...(query?.on_date === undefined ? {} : { on_date: query.on_date }),
      ...(query?.contribution === undefined ? {} : { contribution: query.contribution }),
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json(result.value);
  },
});
