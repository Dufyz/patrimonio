import {
  allocationSchema,
  errorResponseSchema,
  getAllocationSchema,
} from '@patrimonio/contracts';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Estratégia';

export const ALLOCATION_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/allocation',
    tag: TAG,
    summary:
      'A alocação da carteira contra o alvo, em dois níveis, com o valor a mover e a sugestão de aporte',
    request: getAllocationSchema,
    responses: {
      200: {
        description:
          'Uma resposta para a tela inteira, em uma consulta. O grupo é a soma das categorias ' +
          'dentro dele; o desvio é em pontos percentuais, com sinal, e a linha acima da ' +
          'tolerância da carteira chega marcada. Com estratégia declarada, a categoria sem linha ' +
          'de alvo tem alvo zero; sem estratégia, `target_pct` e `deviation_pp` são nulos. ' +
          'Com `contribution`, a resposta traz onde aplicar o aporte para reduzir o maior ' +
          'desvio: o plano só compra, e o que o alvo não pede fica em `unallocated`.',
        schema: allocationSchema,
      },
      404: {
        description: 'Carteira não encontrada ou arquivada.',
        schema: errorResponseSchema,
      },
    },
  },
];
