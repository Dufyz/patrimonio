import {
  errorResponseSchema,
  listPositionsSchema,
  positionsResourceSchema,
} from '@patrimonio/contracts';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Posições';

export const POSITION_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/positions',
    tag: TAG,
    summary: 'As posições abertas hoje, agrupadas',
    request: listPositionsSchema,
    responses: {
      200: {
        description:
          'O último fechamento em ou antes de hoje, com subtotal por grupo, total ' +
          'geral, peso e contagem das pastilhas já somados. Carteira sem fechamento ' +
          'devolve `as_of` nulo e nenhum grupo, que é o estado de primeiro uso.',
        schema: positionsResourceSchema,
      },
      400: {
        description:
          'Agrupamento desconhecido ou identificador de carteira que não é um UUID.',
        schema: errorResponseSchema,
      },
    },
  },
];
