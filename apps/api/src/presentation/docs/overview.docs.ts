import {
  errorResponseSchema,
  getOverviewSchema,
  overviewSchema,
} from '@patrimonio/contracts';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Visão geral';

export const OVERVIEW_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/overview',
    tag: TAG,
    summary: 'A tela de abertura inteira: patrimônio, evolução, composição e pendências',
    request: getOverviewSchema,
    responses: {
      200: {
        description:
          'Uma resposta para a tela inteira, porque a tela é uma pergunta só. ' +
          'O número principal é o do último fechamento — sábado mostra sexta, com a data dita —, ' +
          'o retorno declara de qual cota saiu, e o grupo de pendências sem item não vem: ' +
          'nenhum bloco aparece vazio.',
        schema: overviewSchema,
      },
      404: {
        description: 'Carteira não encontrada.',
        schema: errorResponseSchema,
      },
    },
  },
];
