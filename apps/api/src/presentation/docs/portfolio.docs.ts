import {
  archivePortfolioSchema,
  createPortfolioSchema,
  deletePortfolioSchema,
  errorResponseSchema,
  getPortfolioSchema,
  getStrategySchema,
  listPortfoliosSchema,
  portfolioResourceSchema,
  putStrategySchema,
  strategyTargetResourceSchema,
  updatePortfolioSchema,
} from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Carteiras';

const portfolioResponse = z.object({
  portfolio: portfolioResourceSchema,
  message: z.string(),
});

const portfolioDetailResponse = z.object({
  portfolio: portfolioResourceSchema,
  allocation_targets: z.array(strategyTargetResourceSchema),
});

const targetsResponse = z.object({
  targets: z.array(strategyTargetResourceSchema),
  message: z.string().optional(),
});

export const PORTFOLIO_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/portfolios',
    tag: TAG,
    summary: 'As carteiras da barra lateral',
    request: listPortfoliosSchema,
    responses: {
      200: {
        description:
          'As carteiras ativas, em ordem de exibição. Arquivadas só com include_archived.',
        schema: z.object({ portfolios: z.array(portfolioResourceSchema) }),
      },
    },
  },
  {
    method: 'post',
    path: '/portfolios',
    tag: TAG,
    summary: 'Criar carteira, com alvo de alocação opcional',
    request: createPortfolioSchema,
    responses: {
      201: { description: 'Carteira criada.', schema: portfolioResponse },
      400: {
        description:
          'O alvo de alocação não soma 100%: a resposta diz quantos pontos faltam.',
        schema: errorResponseSchema,
      },
      409: {
        description: 'Já existe uma carteira ativa com esse nome.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'get',
    path: '/portfolios/:portfolio_id',
    tag: TAG,
    summary: 'A carteira e o alvo declarado para ela',
    request: getPortfolioSchema,
    responses: {
      200: { description: 'A carteira existe.', schema: portfolioDetailResponse },
      404: {
        description: 'Não existe carteira com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'patch',
    path: '/portfolios/:portfolio_id',
    tag: TAG,
    summary: 'Editar carteira',
    request: updatePortfolioSchema,
    responses: {
      200: { description: 'Carteira atualizada.', schema: portfolioResponse },
      400: {
        description:
          'Campo inválido, ou alvo que não fecha 100%. recalc_status não é aceito aqui: só a máquina de estados o escreve.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Não existe carteira com esse id.',
        schema: errorResponseSchema,
      },
      409: {
        description: 'O novo nome já é de outra carteira ativa.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'post',
    path: '/portfolios/:portfolio_id/archive',
    tag: TAG,
    summary: 'Arquivar ou reativar a carteira',
    request: archivePortfolioSchema,
    responses: {
      200: {
        description:
          'Arquivada sai da barra lateral, mantém o histórico e libera o nome.',
        schema: portfolioResponse,
      },
      404: {
        description: 'Não existe carteira com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'delete',
    path: '/portfolios/:portfolio_id',
    tag: TAG,
    summary: 'Excluir carteira, movendo ou apagando o conteúdo',
    request: deletePortfolioSchema,
    responses: {
      200: {
        description:
          'Excluída. Quando o conteúdo foi movido, o destino ganha um recálculo.',
        schema: z.object({
          result: z.object({
            deleted_portfolio_id: z.string(),
            moved_transactions: z.number().int(),
            deleted_transactions: z.number().int(),
          }),
          message: z.string(),
        }),
      },
      400: {
        description:
          'O nome digitado não confere, ou mover o conteúdo veio sem carteira de destino.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Não existe carteira com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'get',
    path: '/portfolios/:portfolio_id/strategy',
    tag: TAG,
    summary: 'O alvo de alocação declarado',
    request: getStrategySchema,
    responses: {
      200: {
        description: 'Lista vazia significa "sem estratégia definida".',
        schema: targetsResponse,
      },
      404: {
        description: 'Não existe carteira com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'put',
    path: '/portfolios/:portfolio_id/strategy',
    tag: TAG,
    summary: 'Substituir o alvo de alocação inteiro',
    request: putStrategySchema,
    responses: {
      200: { description: 'Alvo salvo.', schema: targetsResponse },
      400: {
        description: 'A soma não fecha 100%, ou a mesma categoria aparece duas vezes.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Não existe carteira com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
];
