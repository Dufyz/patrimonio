import type {
  confirmCorporateEvent,
  listCorporateEvents,
  registerCorporateEvent,
} from '@patrimonio/application';
import type { RegisterCorporateEventBody } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

export type CorporateEventDeps = {
  readonly usecases: {
    readonly listCorporateEvents: ReturnType<typeof listCorporateEvents>;
    readonly registerCorporateEvent: ReturnType<typeof registerCorporateEvent>;
    readonly confirmCorporateEvent: ReturnType<typeof confirmCorporateEvent>;
  };
};

export type CorporateEventController = {
  readonly list: RequestHandler;
  readonly register: RequestHandler;
  readonly confirm: RequestHandler;
};

export const createCorporateEventController = (
  deps: CorporateEventDeps,
): CorporateEventController => ({
  list: async (request, response) => {
    const query = validatedQuery<{ asset_id?: string; pending?: boolean }>(request);

    const result = await deps.usecases.listCorporateEvents({
      asset_id: query?.asset_id,
      pending: query?.pending,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ events: result.value });
  },

  register: async (request, response) => {
    const result = await deps.usecases.registerCorporateEvent(
      request.body as RegisterCorporateEventBody,
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(201).json({
      event: result.value,
      message: 'Evento registrado, aguardando confirmação',
    });
  },

  /** A quantidade em carteira só muda depois disto. */
  confirm: async (request, response) => {
    const result = await deps.usecases.confirmCorporateEvent(
      String(request.params['event_id']),
      { origin_request_id: request.requestId },
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      event: result.value.event,
      transactions: result.value.transactions,
      portfolios: result.value.portfolios,
      recalculation: result.value.queued.map((event) => ({
        job_id: event.id,
        dedupe_key: event.dedupe_key,
        already_queued: event.already_queued,
      })),
      message: 'Evento aplicado',
    });
  },
});
