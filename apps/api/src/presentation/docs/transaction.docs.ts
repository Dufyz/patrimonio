import {
  createTransactionSchema,
  errorResponseSchema,
  getTransactionSchema,
  listTransactionsSchema,
  previewTransactionSchema,
  transactionPreviewSchema,
  transactionResourceSchema,
} from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Lançamentos';

const queuedWork = z
  .object({
    job_id: z.string(),
    dedupe_key: z.string(),
    already_queued: z.boolean(),
  })
  .nullable();

export const TRANSACTION_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/transactions',
    tag: TAG,
    summary: 'O extrato do livro, com filtros combináveis',
    request: listTransactionsSchema,
    responses: {
      200: {
        description: 'A página pedida, com o total do filtro aplicado.',
        schema: z.object({
          data: z.array(transactionResourceSchema),
          page: z.number().int(),
          limit: z.number().int(),
          total: z.number().int(),
        }),
      },
    },
  },
  {
    method: 'post',
    path: '/transactions',
    tag: TAG,
    summary: 'Criar lançamento',
    request: createTransactionSchema,
    responses: {
      201: {
        description:
          'Gravado. O recálculo vai para a outbox na mesma transação: o modal fecha na hora e a reconstrução acontece atrás.',
        schema: z.object({
          transaction: transactionResourceSchema,
          preview: transactionPreviewSchema,
          recalculation: queuedWork,
          message: z.string(),
        }),
      },
      200: {
        description:
          'Mesma Idempotency-Key de novo: nada foi gravado e a resposta é a do primeiro pedido.',
        schema: z.object({
          transaction: transactionResourceSchema,
          preview: transactionPreviewSchema,
          recalculation: queuedWork,
          message: z.string(),
        }),
      },
      400: {
        description:
          'Venda acima da quantidade disponível, liquidação antes da operação, ou campo que o tipo exige e não veio.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Carteira ou ativo informado não existe.',
        schema: errorResponseSchema,
      },
      409: { description: 'A carteira está arquivada.', schema: errorResponseSchema },
    },
  },
  {
    method: 'post',
    path: '/transactions/preview',
    tag: TAG,
    summary: 'O efeito do lançamento, antes de salvar',
    request: previewTransactionSchema,
    responses: {
      200: {
        description:
          'Antes e depois de quantidade, preço médio, custo, peso e caixa. Os mesmos números que a gravação produz, e nada é criado.',
        schema: z.object({ preview: transactionPreviewSchema }),
      },
      400: { description: 'O lançamento não é válido.', schema: errorResponseSchema },
      404: {
        description: 'Carteira ou ativo informado não existe.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'get',
    path: '/transactions/:transaction_id',
    tag: TAG,
    summary: 'Um lançamento',
    request: getTransactionSchema,
    responses: {
      200: {
        description: 'O lançamento existe.',
        schema: z.object({ transaction: transactionResourceSchema }),
      },
      404: {
        description: 'Não existe lançamento com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
];
