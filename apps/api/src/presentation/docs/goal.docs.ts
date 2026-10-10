import { errorResponseSchema, getGoalsSchema, goalsSchema } from '@patrimonio/contracts';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Objetivos';

export const GOAL_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/goals',
    tag: TAG,
    summary:
      'Os objetivos abertos contra o patrimônio: progresso, projeção a uma taxa declarada, as duas trajetórias e a tabela de aportes',
    request: getGoalsSchema,
    responses: {
      200: {
        description:
          'Uma resposta para a tela inteira, em uma consulta, do prazo mais próximo ao mais ' +
          'distante. Cada objetivo é medido pelas carteiras ligadas a ele — ou pelo patrimônio ' +
          'todo, quando não aponta nenhuma — e `portfolio_id` só escolhe quais objetivos entram. ' +
          'A taxa usada vem em `rate`, com a moeda dela: real quando a meta é em reais de ' +
          'hoje, nominal quando é em reais da data alvo. `rates` troca a taxa de um objetivo ' +
          'sem gravar nada. Projeção que não pode ser feita — sem premissa entendida, sem ' +
          'IPCA para uma meta nominal, sem história — chega como `projection: null` com o ' +
          'motivo em `blocked`; objetivo cumprido ou vencido não projeta.',
        schema: goalsSchema,
      },
      404: {
        description: 'Carteira do filtro não encontrada ou arquivada.',
        schema: errorResponseSchema,
      },
    },
  },
];
