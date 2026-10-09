import {
  errorResponseSchema,
  getStatementSchema,
  statementResourceSchema,
} from '@patrimonio/contracts';

import type { RouteDoc } from './route-doc.js';

export const STATEMENT_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/statement',
    tag: 'Lançamentos',
    summary: 'O extrato do livro, com o efeito de cada lançamento',
    request: getStatementSchema,
    responses: {
      200: {
        description:
          'Uma página de lançamentos do recorte — carteira, instituição, tipo, ' +
          'busca e período — com o efeito de cada um na posição, o resumo do ' +
          'período, o subtotal de cada mês, a contagem por tipo e o mês anterior ' +
          'ao início. Os agregados descrevem o recorte inteiro, não a página. ' +
          'A contagem por tipo ignora o tipo já escolhido, para as outras ' +
          'pastilhas não zerarem no primeiro clique.',
        schema: statementResourceSchema,
      },
      400: {
        description:
          'Identificador que não é um UUID, tipo desconhecido, data inválida ou ' +
          'período com o início depois do fim.',
        schema: errorResponseSchema,
      },
    },
  },
];
