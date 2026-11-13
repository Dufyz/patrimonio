import {
  errorResponseSchema,
  getProjectionSchema,
  projectionSchema,
  putProjectionPlanResponseSchema,
  putProjectionPlanSchema,
} from '@patrimonio/contracts';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Projeção';

export const PROJECTION_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/projection',
    tag: TAG,
    summary:
      'A projeção das carteiras: série mensal, aporte e rendimento acumulados e KPIs, por carteira e no total',
    request: getProjectionSchema,
    responses: {
      200: {
        description:
          'Uma leitura só. `saldo(t+1) = saldo(t) × (1 + r_m) + aporte(t)`, com `r_m` a taxa ' +
          'mensal equivalente à rentabilidade anual esperada; o aporte do mês é a soma das ' +
          'regras de valor fixo ativas nele. Carteira sem rentabilidade usa 0,00% e vem com ' +
          '`return_assumed_zero`; carteira ainda não consolidada vem com `projection: null`.',
        schema: projectionSchema,
      },
      404: {
        description: 'Carteira do filtro não encontrada.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'put',
    path: '/portfolios/{portfolio_id}/projection-plan',
    tag: TAG,
    summary: 'Troca a rentabilidade esperada e as regras de aporte da carteira',
    request: putProjectionPlanSchema,
    responses: {
      200: {
        description:
          'Plano gravado: a rentabilidade e as regras anteriores são substituídas.',
        schema: putProjectionPlanResponseSchema,
      },
      404: { description: 'Carteira não encontrada.', schema: errorResponseSchema },
    },
  },
];
