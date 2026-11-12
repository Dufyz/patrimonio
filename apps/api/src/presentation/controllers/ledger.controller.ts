import type { createContribution, createRedemption } from '@patrimonio/application';
import type { ContributionBody, RedemptionBody } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { idempotencyKey, sendFailure, validatedQuery } from '../middleware/respond.js';

export type LedgerDeps = {
  readonly usecases: {
    readonly createContribution: ReturnType<typeof createContribution>;
    readonly createRedemption: ReturnType<typeof createRedemption>;
  };
};

export type LedgerController = {
  readonly contribute: RequestHandler;
  readonly redeem: RequestHandler;
};

export const createLedgerController = (deps: LedgerDeps): LedgerController => ({
  /**
   * LIV-03 · Aporte, conta → carteira. `?preview=true` devolve o efeito sem gravar,
   * sem consumir a `Idempotency-Key` e sem enfileirar recálculo (LIV-07).
   */
  contribute: async (request, response) => {
    const body = request.body as ContributionBody;
    const query = validatedQuery<{ preview?: string } | undefined>(request);
    const preview = query?.preview === 'true';
    const key = idempotencyKey(request);

    const result = await deps.usecases.createContribution({
      ...body,
      preview,
      ...(key === undefined || preview ? {} : { idempotency_key: key }),
      origin_request_id: request.requestId,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    const value = result.value;
    if (preview) {
      response.status(200).json({
        preview: true,
        amount: value.amount,
        account: value.account,
        position: value.preview?.position ?? null,
      });
      return;
    }

    response.status(value.replayed ? 200 : 201).json({
      transaction: value.transaction,
      amount: value.amount,
      account: value.account,
      position: value.preview?.position ?? null,
      event_id: value.event_id,
      recalculation:
        value.queued === null
          ? null
          : {
              job_id: value.queued.id,
              dedupe_key: value.queued.dedupe_key,
              already_queued: value.queued.already_queued,
            },
      replayed: value.replayed,
    });
  },

  /** LIV-04 · Resgate, carteira → conta, com despesa ligada opcional. */
  redeem: async (request, response) => {
    const body = request.body as RedemptionBody;
    const query = validatedQuery<{ preview?: string } | undefined>(request);
    const preview = query?.preview === 'true';
    const key = idempotencyKey(request);

    const result = await deps.usecases.createRedemption({
      ...body,
      preview,
      ...(key === undefined || preview ? {} : { idempotency_key: key }),
      origin_request_id: request.requestId,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    const value = result.value;
    if (preview) {
      response.status(200).json({
        preview: true,
        amount: value.amount,
        account: value.account,
        position: value.preview?.position ?? null,
      });
      return;
    }

    response.status(value.replayed ? 200 : 201).json({
      transaction: value.transaction,
      amount: value.amount,
      account: value.account,
      position: value.preview?.position ?? null,
      expense_id: value.expense_id,
      event_id: value.event_id,
      recalculation:
        value.queued === null
          ? null
          : {
              job_id: value.queued.id,
              dedupe_key: value.queued.dedupe_key,
              already_queued: value.queued.already_queued,
            },
      replayed: value.replayed,
    });
  },
});
