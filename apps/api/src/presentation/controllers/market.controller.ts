import type {
  getAssetPriceSeries,
  getMarketHealth,
  refreshMarketData,
} from '@patrimonio/application';
import type { RefreshMarketBody } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/**
 * As rotas que a tela de dados de mercado lê. Ela existe para responder uma
 * pergunta só — o número que está na tela é de hoje? — e por isso cada resposta
 * daqui carrega a procedência do número, não só o número.
 *
 * A tela em si entra em E6, junto com as outras: o design system é E5, e montar
 * uma tela antes dele seria desenhar duas vezes. O que está pronto é o que ela
 * consome.
 */
export type MarketDeps = {
  readonly usecases: {
    readonly getMarketHealth: ReturnType<typeof getMarketHealth>;
    readonly refreshMarketData: ReturnType<typeof refreshMarketData>;
    readonly getAssetPriceSeries: ReturnType<typeof getAssetPriceSeries>;
  };
};

export type MarketController = {
  readonly health: RequestHandler;
  readonly refresh: RequestHandler;
  readonly priceSeries: RequestHandler;
};

type HealthQuery = { readonly on_date?: string };
type SeriesQuery = { readonly from?: string; readonly to?: string };

export const createMarketController = (deps: MarketDeps): MarketController => ({
  health: async (request, response) => {
    const query = validatedQuery<HealthQuery>(request);

    const result = await deps.usecases.getMarketHealth({
      ...(query?.on_date === undefined ? {} : { on_date: query.on_date }),
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json(result.value);
  },

  /**
   * "Atualizar agora" devolve 202 com `job_id` e `already_queued`: a coleta leva
   * segundos, e a tela não espera a fonte responder. Dois cliques seguidos viram
   * uma coleta, pela coalescência da outbox.
   */
  refresh: async (request, response) => {
    const body = request.body as RefreshMarketBody;

    const result = await deps.usecases.refreshMarketData({
      ...(body.on_date === undefined ? {} : { on_date: body.on_date }),
      ...(body.asset_id === undefined ? {} : { asset_id: body.asset_id }),
      ...(request.requestId === undefined
        ? {}
        : { origin_request_id: request.requestId }),
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(202).json({
      reference_date: result.value.reference_date,
      job_id: result.value.queued.id,
      dedupe_key: result.value.queued.dedupe_key,
      already_queued: result.value.queued.already_queued,
      message:
        body.asset_id === undefined
          ? 'Coleta enfileirada.'
          : 'Backfill do ativo enfileirado.',
    });
  },

  priceSeries: async (request, response) => {
    const query = validatedQuery<SeriesQuery>(request);

    const result = await deps.usecases.getAssetPriceSeries({
      asset_id: String(request.params['asset_id']),
      ...(query?.from === undefined ? {} : { from: query.from }),
      ...(query?.to === undefined ? {} : { to: query.to }),
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json(result.value);
  },
});
