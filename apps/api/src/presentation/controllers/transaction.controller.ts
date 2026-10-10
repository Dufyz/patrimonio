import type {
  confirmPayout,
  deleteTransaction,
  interpretTransaction,
  createCashMovement,
  createPayout,
  dismissPayout,
  previewPayout,
  createTransaction,
  getTransaction,
  listTransactions,
  previewTransaction,
  previewUpdate,
  undoDeletion,
  updateTransaction,
} from '@patrimonio/application';
import type {
  ConfirmPayoutBody,
  CreateCashMovementBody,
  DismissPayoutBody,
  CreatePayoutBody,
  CreateTransactionBody,
  InterpretTransactionBody,
  UpdateTransactionBody,
} from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { idempotencyKey, sendFailure, validatedQuery } from '../middleware/respond.js';

export type TransactionDeps = {
  readonly usecases: {
    readonly createTransaction: ReturnType<typeof createTransaction>;
    readonly createCashMovement: ReturnType<typeof createCashMovement>;
    readonly createPayout: ReturnType<typeof createPayout>;
    readonly confirmPayout: ReturnType<typeof confirmPayout>;
    readonly dismissPayout: ReturnType<typeof dismissPayout>;
    readonly previewPayout: ReturnType<typeof previewPayout>;
    readonly previewTransaction: ReturnType<typeof previewTransaction>;
    readonly listTransactions: ReturnType<typeof listTransactions>;
    readonly getTransaction: ReturnType<typeof getTransaction>;
    readonly updateTransaction: ReturnType<typeof updateTransaction>;
    readonly previewUpdate: ReturnType<typeof previewUpdate>;
    readonly deleteTransaction: ReturnType<typeof deleteTransaction>;
    readonly undoDeletion: ReturnType<typeof undoDeletion>;
    readonly interpretTransaction: ReturnType<typeof interpretTransaction>;
  };
};

export type TransactionController = {
  readonly create: RequestHandler;
  readonly cash: RequestHandler;
  readonly payout: RequestHandler;
  readonly confirm: RequestHandler;
  readonly dismiss: RequestHandler;
  readonly previewPayout: RequestHandler;
  readonly preview: RequestHandler;
  readonly list: RequestHandler;
  readonly detail: RequestHandler;
  readonly update: RequestHandler;
  readonly previewUpdate: RequestHandler;
  readonly remove: RequestHandler;
  readonly undo: RequestHandler;
  readonly interpret: RequestHandler;
};

type ListQuery = {
  readonly page: number;
  readonly limit: number;
  readonly portfolio_id?: string;
  readonly asset_id?: string;
  readonly institution_id?: string;
  readonly kind?: CreateTransactionBody['kind'];
  readonly from?: string;
  readonly to?: string;
  readonly pending_payouts?: boolean;
};

export const createTransactionController = (
  deps: TransactionDeps,
): TransactionController => ({
  create: async (request, response) => {
    const body = request.body as CreateTransactionBody;

    const result = await deps.usecases.createTransaction({
      ...body,
      ...(idempotencyKey(request) === undefined
        ? {}
        : { idempotency_key: idempotencyKey(request) }),
      origin_request_id: request.requestId,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    const { transaction, preview, queued, replayed } = result.value;

    response.status(replayed ? 200 : 201).json({
      transaction,
      preview,
      // O recálculo acontece atrás: o modal fecha na hora, com o lançamento já
      // gravado na tabela de fonte.
      recalculation:
        queued === null
          ? null
          : {
              job_id: queued.id,
              dedupe_key: queued.dedupe_key,
              already_queued: queued.already_queued,
            },
      message: replayed ? 'Lançamento já havia sido criado' : 'Lançamento criado',
    });
  },

  /**
   * Aporte e resgate. O caixa é um ativo sintético por instituição, criado na
   * primeira vez que dinheiro entra ali: o aporte é um lançamento como os
   * outros, e o dinheiro parado aparece em Posições e na alocação.
   */
  cash: async (request, response) => {
    const body = request.body as CreateCashMovementBody;

    const result = await deps.usecases.createCashMovement({
      ...body,
      ...(idempotencyKey(request) === undefined
        ? {}
        : { idempotency_key: idempotencyKey(request) }),
      origin_request_id: request.requestId,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(result.value.replayed ? 200 : 201).json({
      transactions: result.value.transactions,
      preview: result.value.preview,
      recalculation: result.value.queued.map((event) => ({
        job_id: event.id,
        dedupe_key: event.dedupe_key,
        already_queued: event.already_queued,
      })),
      message: result.value.replayed
        ? 'Lançamento já havia sido criado'
        : body.kind === 'deposit'
          ? 'Aporte registrado'
          : 'Resgate registrado',
    });
  },

  /**
   * Provento. A quantidade na data-com é calculada pelos lançamentos, e o que
   * ainda não foi pago nasce "a receber": só vira dinheiro quando o recebimento
   * é confirmado.
   */
  payout: async (request, response) => {
    const body = request.body as CreatePayoutBody;

    const result = await deps.usecases.createPayout({
      ...body,
      ...(idempotencyKey(request) === undefined
        ? {}
        : { idempotency_key: idempotencyKey(request) }),
      origin_request_id: request.requestId,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(result.value.replayed ? 200 : 201).json({
      transaction: result.value.transaction,
      preview: result.value.preview,
      quantity_at_record_date: result.value.quantity_at_record_date,
      recalculation:
        result.value.queued === null
          ? null
          : {
              job_id: result.value.queued.id,
              dedupe_key: result.value.queued.dedupe_key,
              already_queued: result.value.queued.already_queued,
            },
      message:
        result.value.transaction.confirmed_at === null
          ? 'Provento registrado como a receber'
          : 'Provento registrado',
    });
  },

  /** O recebimento confirmado, com a diferença contra o previsto, se houver. */
  confirm: async (request, response) => {
    const body = request.body as ConfirmPayoutBody;

    const result = await deps.usecases.confirmPayout(
      String(request.params['transaction_id']),
      { ...body, origin_request_id: request.requestId },
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      transaction: result.value.transaction,
      expected_net_amount: result.value.expected_net_amount,
      difference: result.value.difference,
      recalculation:
        result.value.queued === null
          ? null
          : {
              job_id: result.value.queued.id,
              dedupe_key: result.value.queued.dedupe_key,
              already_queued: result.value.queued.already_queued,
            },
      message: 'Recebimento confirmado',
    });
  },

  dismiss: async (request, response) => {
    const body = request.body as DismissPayoutBody;

    const result = await deps.usecases.dismissPayout(
      String(request.params['transaction_id']),
      { reason: body.reason, origin_request_id: request.requestId },
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      dismissal: result.value.dismissal,
      message: 'Provento marcado como não pago',
    });
  },

  /**
   * O provento antes de salvar: a quantidade na data-com, o bruto e o IR retido
   * saem do mesmo cálculo da gravação, e nada é criado.
   */
  previewPayout: async (request, response) => {
    const result = await deps.usecases.previewPayout({
      ...(request.body as CreatePayoutBody),
      origin_request_id: request.requestId,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json(result.value);
  },

  preview: async (request, response) => {
    const result = await deps.usecases.previewTransaction({
      ...(request.body as CreateTransactionBody),
      origin_request_id: request.requestId,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ preview: result.value });
  },

  list: async (request, response) => {
    const query = validatedQuery<ListQuery>(request);

    const result = await deps.usecases.listTransactions({
      page: query?.page ?? 1,
      limit: query?.limit ?? 50,
      portfolio_id: query?.portfolio_id,
      asset_id: query?.asset_id,
      institution_id: query?.institution_id,
      kind: query?.kind,
      from: query?.from,
      to: query?.to,
      pending_payouts: query?.pending_payouts,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      data: result.value.data,
      page: query?.page ?? 1,
      limit: query?.limit ?? 50,
      total: result.value.total,
    });
  },

  detail: async (request, response) => {
    const result = await deps.usecases.getTransaction(
      String(request.params['transaction_id']),
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ transaction: result.value });
  },

  /**
   * Editar mostra o que vai mudar e salva com os mesmos números. O recálculo
   * sai com a data mais antiga tocada, e o modal fecha na hora.
   */
  update: async (request, response) => {
    const body = request.body as UpdateTransactionBody;

    const result = await deps.usecases.updateTransaction(
      String(request.params['transaction_id']),
      { ...body, origin_request_id: request.requestId },
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      transaction: result.value.transaction,
      preview: result.value.preview,
      recalculation: result.value.queued.map((event) => ({
        job_id: event.id,
        dedupe_key: event.dedupe_key,
        already_queued: event.already_queued,
      })),
      message: 'Lançamento atualizado',
    });
  },

  previewUpdate: async (request, response) => {
    const body = request.body as UpdateTransactionBody;

    const result = await deps.usecases.previewUpdate(
      String(request.params['transaction_id']),
      { ...body, origin_request_id: request.requestId },
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ preview: result.value });
  },

  /** Excluir devolve o impacto e o token do desfazer, que vale por segundos. */
  remove: async (request, response) => {
    const result = await deps.usecases.deleteTransaction(
      String(request.params['transaction_id']),
      { origin_request_id: request.requestId },
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      deleted: result.value.deleted,
      impact: result.value.impact,
      undo: {
        undo_id: result.value.undo_id,
        expires_at: result.value.undo_expires_at,
      },
      recalculation: result.value.queued.map((event) => ({
        job_id: event.id,
        dedupe_key: event.dedupe_key,
        already_queued: event.already_queued,
      })),
      message: 'Lançamento excluído',
    });
  },

  undo: async (request, response) => {
    const result = await deps.usecases.undoDeletion(String(request.params['undo_id']), {
      origin_request_id: request.requestId,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      transactions: result.value.restored,
      recalculation: result.value.queued.map((event) => ({
        job_id: event.id,
        dedupe_key: event.dedupe_key,
        already_queued: event.already_queued,
      })),
      message: 'Exclusão desfeita',
    });
  },

  /**
   * Uma linha de texto vira lançamento interpretado. Nada é gravado aqui: a
   * interpretação volta em pastilhas, e texto ambíguo diz o que falta em vez de
   * salvar um palpite.
   */
  interpret: async (request, response) => {
    const body = request.body as InterpretTransactionBody;

    const result = await deps.usecases.interpretTransaction(body.text);

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ interpretation: result.value });
  },
});
