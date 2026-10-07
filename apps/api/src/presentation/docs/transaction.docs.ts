import {
  confirmPayoutSchema,
  createCashMovementSchema,
  createPayoutSchema,
  deleteTransactionSchema,
  interpretTransactionSchema,
  deletionImpactSchema,
  previewUpdateSchema,
  previewTransferSchema,
  transferPositionSchema,
  textInterpretationSchema,
  undoDeletionSchema,
  updateTransactionSchema,
  transferPreviewSchema,
  dismissPayoutSchema,
  payoutDismissalResourceSchema,
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
          'Mesma Idempotency-Key de novo: nada foi gravado, a resposta traz o lançamento do primeiro pedido e o preview vem nulo — ele descrevia o estado daquele momento.',
        schema: z.object({
          transaction: transactionResourceSchema,
          preview: transactionPreviewSchema.nullable(),
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
    path: '/transactions/cash',
    tag: TAG,
    summary: 'Aporte e resgate de caixa',
    request: createCashMovementSchema,
    responses: {
      201: {
        description:
          'Gravado. De fora do app conta como aporte; de outra carteira vira transferência com duas pernas, e o patrimônio total não muda.',
        schema: z.object({
          transactions: z.array(transactionResourceSchema),
          preview: transactionPreviewSchema,
          recalculation: z.array(
            z.object({
              job_id: z.string(),
              dedupe_key: z.string(),
              already_queued: z.boolean(),
            }),
          ),
          message: z.string(),
        }),
      },
      400: {
        description:
          'Origem "de outra carteira" sem a carteira de origem, ou valor inválido.',
        schema: errorResponseSchema,
      },
      404: { description: 'Carteira não encontrada.', schema: errorResponseSchema },
    },
  },
  {
    method: 'post',
    path: '/transactions/payouts',
    tag: TAG,
    summary: 'Dividendo, JCP, rendimento, juros e amortização',
    request: createPayoutSchema,
    responses: {
      201: {
        description:
          'Gravado. A quantidade na data-com é calculada pelos lançamentos; o que ainda não foi pago fica "a receber".',
        schema: z.object({
          transaction: transactionResourceSchema,
          preview: transactionPreviewSchema,
          quantity_at_record_date: z.string(),
          recalculation: queuedWork,
          message: z.string(),
        }),
      },
      400: {
        description:
          'Pagamento antes da data-com, ou nenhuma posição no ativo na data-com.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Carteira ou ativo não encontrado.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'post',
    path: '/transactions/transfer',
    tag: TAG,
    summary: 'Mover uma posição entre carteiras, sem vender',
    request: transferPositionSchema,
    responses: {
      201: {
        description:
          'As duas pernas gravadas na mesma transação, ligadas pelo mesmo grupo. O preço médio é preservado e o patrimônio total não muda.',
        schema: z.object({
          transactions: z.array(transactionResourceSchema),
          preview: transferPreviewSchema,
          recalculation: z.array(
            z.object({
              job_id: z.string(),
              dedupe_key: z.string(),
              already_queued: z.boolean(),
            }),
          ),
          message: z.string(),
        }),
      },
      400: {
        description: 'Quantidade maior do que a posição da origem, ou carteiras iguais.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Carteira ou ativo não encontrado.',
        schema: errorResponseSchema,
      },
      409: {
        description: 'Uma das carteiras está arquivada.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'post',
    path: '/transactions/transfer/preview',
    tag: TAG,
    summary: 'O efeito da transferência nas duas carteiras',
    request: previewTransferSchema,
    responses: {
      200: {
        description:
          'Antes e depois das duas carteiras, e a variação do patrimônio total, que é zero.',
        schema: z.object({ preview: transferPreviewSchema }),
      },
      400: { description: 'A transferência não é válida.', schema: errorResponseSchema },
      404: {
        description: 'Carteira ou ativo não encontrado.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'post',
    path: '/transactions/:transaction_id/confirm',
    tag: TAG,
    summary: 'Confirmar o recebimento de um provento',
    request: confirmPayoutSchema,
    responses: {
      200: {
        description:
          'Confirmado. Quando o recebido difere do previsto, a resposta traz os dois e a diferença.',
        schema: z.object({
          transaction: transactionResourceSchema,
          expected_net_amount: z.string().nullable(),
          difference: z.string().nullable(),
          recalculation: queuedWork,
          message: z.string(),
        }),
      },
      400: {
        description: 'O lançamento não é um provento.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Não existe lançamento com esse id.',
        schema: errorResponseSchema,
      },
      409: {
        description: 'Este provento já foi confirmado.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'post',
    path: '/transactions/:transaction_id/dismiss',
    tag: TAG,
    summary: 'Marcar um provento como não pago',
    request: dismissPayoutSchema,
    responses: {
      200: {
        description:
          'O provento sai do livro e o motivo fica registrado, para a dúvida não voltar a cada anúncio.',
        schema: z.object({
          dismissal: payoutDismissalResourceSchema,
          message: z.string(),
        }),
      },
      400: {
        description: 'O lançamento não é um provento, ou já foi recebido.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Não existe lançamento com esse id.',
        schema: errorResponseSchema,
      },
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
  {
    method: 'patch',
    path: '/transactions/:transaction_id',
    tag: TAG,
    summary: 'Editar lançamento',
    request: updateTransactionSchema,
    responses: {
      200: {
        description:
          'Gravado. O recálculo sai com a data mais antiga tocada — a nova ou a antiga, o que for anterior.',
        schema: z.object({
          transaction: transactionResourceSchema,
          preview: transactionPreviewSchema,
          recalculation: z.array(
            z.object({
              job_id: z.string(),
              dedupe_key: z.string(),
              already_queued: z.boolean(),
            }),
          ),
          message: z.string(),
        }),
      },
      400: {
        description:
          'Venda que passaria da posição, ou perna de transferência editada sozinha.',
        schema: errorResponseSchema,
      },
      404: {
        description: 'Não existe lançamento com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'post',
    path: '/transactions/:transaction_id/preview',
    tag: TAG,
    summary: 'O efeito da edição, antes de salvar',
    request: previewUpdateSchema,
    responses: {
      200: {
        description:
          'O "antes" é a posição sem aquela linha, não a de ontem: é o mesmo plano que a gravação usa.',
        schema: z.object({ preview: transactionPreviewSchema }),
      },
      400: { description: 'A edição não é válida.', schema: errorResponseSchema },
      404: {
        description: 'Não existe lançamento com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'delete',
    path: '/transactions/:transaction_id',
    tag: TAG,
    summary: 'Excluir lançamento, com desfazer',
    request: deleteTransactionSchema,
    responses: {
      200: {
        description:
          'Excluído. A resposta traz o impacto nos números e o token do desfazer, que vale por alguns segundos.',
        schema: z.object({
          deleted: z.array(transactionResourceSchema),
          impact: deletionImpactSchema,
          undo: z.object({ undo_id: z.string(), expires_at: z.string() }),
          recalculation: z.array(
            z.object({
              job_id: z.string(),
              dedupe_key: z.string(),
              already_queued: z.boolean(),
            }),
          ),
          message: z.string(),
        }),
      },
      404: {
        description: 'Não existe lançamento com esse id.',
        schema: errorResponseSchema,
      },
    },
  },
  {
    method: 'post',
    path: '/transactions/undo/:undo_id',
    tag: TAG,
    summary: 'Desfazer a exclusão dentro da janela',
    request: undoDeletionSchema,
    responses: {
      200: {
        description:
          'O estado anterior volta idêntico, com os mesmos ids, e o recálculo é pedido de novo.',
        schema: z.object({
          transactions: z.array(transactionResourceSchema),
          recalculation: z.array(
            z.object({
              job_id: z.string(),
              dedupe_key: z.string(),
              already_queued: z.boolean(),
            }),
          ),
          message: z.string(),
        }),
      },
      404: {
        description: 'Não há o que desfazer com esse token.',
        schema: errorResponseSchema,
      },
      409: { description: 'A janela do desfazer fechou.', schema: errorResponseSchema },
    },
  },
  {
    method: 'post',
    path: '/transactions/interpret',
    tag: TAG,
    summary: 'Interpretar uma linha de texto como lançamento',
    request: interpretTransactionSchema,
    responses: {
      200: {
        description:
          '`compra 100 itub4 36,84 ontem` volta em pastilhas, com o ativo resolvido contra o cadastro. Nada é gravado, e texto ambíguo diz o que falta.',
        schema: z.object({ interpretation: textInterpretationSchema }),
      },
    },
  },
];
