import {
  assetPriceSeriesSchema,
  errorResponseSchema,
  getAssetPriceSeriesSchema,
  getMarketHealthSchema,
  marketHealthSchema,
  refreshMarketSchema,
} from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Dados de mercado';

export const MARKET_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/market/health',
    tag: TAG,
    summary: 'Situação de cada fonte, cobertura e papéis sem preço',
    request: getMarketHealthSchema,
    responses: {
      200: {
        description:
          'Por fonte: situação, horário da última coleta, cobertura e consumo de cota. ' +
          'A falha vem com a mensagem do erro, não com um código.',
        schema: marketHealthSchema,
      },
    },
  },
  {
    method: 'post',
    path: '/market/refresh',
    tag: TAG,
    summary: 'Atualizar agora',
    request: refreshMarketSchema,
    responses: {
      202: {
        description:
          'Enfileirado, com retorno imediato: a coleta leva segundos e a tela não espera. ' +
          'Dois pedidos seguidos viram uma coleta, pela coalescência da outbox.',
        schema: z.object({
          reference_date: z.string(),
          job_id: z.string(),
          dedupe_key: z.string(),
          already_queued: z.boolean(),
          message: z.string(),
        }),
      },
    },
  },
  {
    method: 'get',
    path: '/assets/:asset_id/prices',
    tag: TAG,
    summary: 'A série de preço do ativo, negociada e ajustada',
    request: getAssetPriceSeriesSchema,
    responses: {
      200: {
        description:
          'As duas séries saem da mesma leitura: `close` é o preço como foi negociado, ' +
          'que todo cálculo de patrimônio usa, e `adjusted_close` é o mesmo preço na escala ' +
          'de hoje, para o gráfico. Alternar entre elas não altera nenhum dado gravado.',
        schema: assetPriceSeriesSchema,
      },
      404: { description: 'Ativo não encontrado.', schema: errorResponseSchema },
    },
  },
];
