import type { getStatement } from '@patrimonio/application';
import type { GetStatementQuery } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/**
 * T-04 · O extrato do livro, com o efeito de cada lançamento.
 *
 * Uma rota só, e leitura: editar e excluir continuam em `/transactions`, que é
 * onde o livro é escrito. O recorte inteiro — carteira, instituição, tipo,
 * busca, período e página — vem na query, que é o que a URL da tela carrega:
 * colar o endereço em outra aba reproduz exatamente o que estava na tela.
 *
 * O controller não soma nem filtra. Resumo, subtotal de mês e contagem por tipo
 * chegam prontos do repositório, e o efeito de cada linha vem do motor.
 */
export type StatementDeps = {
  readonly usecases: { readonly getStatement: ReturnType<typeof getStatement> };
};

export type StatementController = { readonly list: RequestHandler };

export const createStatementController = (deps: StatementDeps): StatementController => ({
  list: async (request, response) => {
    const query = validatedQuery<GetStatementQuery>(request);

    const result = await deps.usecases.getStatement({
      portfolioId: query.portfolio_id,
      institutionId: query.institution_id ?? null,
      group: query.group ?? null,
      search: query.search === undefined || query.search === '' ? null : query.search,
      from: query.from ?? null,
      to: query.to ?? null,
      page: query.page,
      limit: query.limit,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json(result.value);
  },
});
