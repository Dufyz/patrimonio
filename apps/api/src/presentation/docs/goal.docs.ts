import {
  deleteGoalSchema,
  errorResponseSchema,
  getGoalsOverviewSchema,
  getGoalsSchema,
  goalsOverviewSchema,
  goalsSchema,
  previewGoalResponseSchema,
  previewGoalSchema,
  putGoalResponseSchema,
  putGoalSchema,
} from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Objetivos';

export const GOAL_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/goals',
    tag: TAG,
    summary:
      'O objetivo da carteira contra o patrimônio: progresso, projeção a uma taxa declarada, as duas trajetórias e a tabela de aportes',
    request: getGoalsSchema,
    responses: {
      200: {
        description:
          'Uma resposta para a tela inteira, em uma consulta. Uma carteira tem no máximo um ' +
          'objetivo aberto, e é o valor dela que o mede: `goal` é nulo quando ainda não há. ' +
          'A taxa usada vem em `goal.rate`, com a moeda dela: real quando a meta é em reais ' +
          'de hoje, nominal quando é em reais da data alvo. O parâmetro `rate` troca a taxa ' +
          'do objetivo sem gravar nada. Projeção que não pode ser feita — sem premissa entendida, sem ' +
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
  {
    method: 'get',
    path: '/goals/overview',
    tag: TAG,
    summary:
      'Os objetivos de todas as carteiras: o aporte mensal necessário no total e em cada carteira, e quando todas as metas fecham',
    request: getGoalsOverviewSchema,
    responses: {
      200: {
        description:
          'Um panorama, em uma consulta: uma linha por carteira ativa, com o objetivo dela ' +
          'ou `goal: null`. Só entram nas somas as metas em reais de hoje, com projeção ou ' +
          'já cumpridas; as outras ficam na tabela com o motivo em `excluded_reason`. ' +
          '`plan` distribui o orçamento pedido (`budget`, padrão o aporte necessário ' +
          'total) entre as carteiras — proporcional ao necessário ou por `priority` — e ' +
          '`cascade` reaproveita a parcela de uma meta que já fechou. É aporte futuro: o ' +
          'dinheiro já investido numa carteira não migra para outra. `rates` simula a ' +
          'rentabilidade de cada carteira no lugar da premissa, sem gravar. `arrival_date` nulo é ' +
          '"alguma meta não fecha em cem anos".',
        schema: goalsOverviewSchema,
      },
    },
  },
  {
    method: 'put',
    path: '/portfolios/:portfolio_id/goal',
    tag: TAG,
    summary: 'Criar ou editar o objetivo da carteira',
    request: putGoalSchema,
    responses: {
      200: { description: 'Objetivo editado.', schema: putGoalResponseSchema },
      201: { description: 'Objetivo criado.', schema: putGoalResponseSchema },
      400: {
        description:
          'A data não é futura, ou a premissa não foi entendida (use `IPCA+6` ou `6`).',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Carteira não encontrada ou arquivada.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'delete',
    path: '/portfolios/:portfolio_id/goal',
    tag: TAG,
    summary: 'Excluir o objetivo da carteira',
    request: deleteGoalSchema,
    responses: {
      200: {
        description:
          'Objetivo excluído. Posições, lançamentos e patrimônio não mudam: ele só media a carteira.',
        schema: z.object({ message: z.string() }),
      },
      404: {
        description: 'A carteira não tem objetivo.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'post',
    path: '/portfolios/:portfolio_id/goal/preview',
    tag: TAG,
    summary: 'Projetar o objetivo do formulário, sem gravar',
    request: previewGoalSchema,
    responses: {
      200: {
        description:
          'O objetivo como ficaria, pela mesma conta e sobre o mesmo fechamento da tela. Recusa o mesmo que o `PUT` recusaria.',
        schema: previewGoalResponseSchema,
      },
      400: {
        description: 'A data não é futura, ou a premissa não foi entendida.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Carteira não encontrada ou arquivada.',
        schema: errorResponseSchema,
      },
    },
  },
];
