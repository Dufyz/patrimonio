import type {
  createTransaction,
  getTransaction,
  listTransactions,
  previewTransaction,
} from '@patrimonio/application';
import type { CreateTransactionBody } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { idempotencyKey, sendFailure, validatedQuery } from '../middleware/respond.js';

export type TransactionDeps = {
  readonly usecases: {
    readonly createTransaction: ReturnType<typeof createTransaction>;
    readonly previewTransaction: ReturnType<typeof previewTransaction>;
    readonly listTransactions: ReturnType<typeof listTransactions>;
    readonly getTransaction: ReturnType<typeof getTransaction>;
  };
};

export type TransactionController = {
  readonly create: RequestHandler;
  readonly preview: RequestHandler;
  readonly list: RequestHandler;
  readonly detail: RequestHandler;
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
});
