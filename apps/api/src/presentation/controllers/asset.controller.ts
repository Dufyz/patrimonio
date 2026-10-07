import type {
  archiveAsset,
  deleteManualPrice,
  createAsset,
  createFixedIncomeAsset,
  deleteAsset,
  getAsset,
  listAssets,
  listManualPrices,
  setManualPrice,
  updateAsset,
} from '@patrimonio/application';
import type {
  CreateAssetBody,
  SetManualPriceBody,
  UpdateAssetBody,
} from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

export type AssetDeps = {
  readonly usecases: {
    readonly listAssets: ReturnType<typeof listAssets>;
    readonly getAsset: ReturnType<typeof getAsset>;
    readonly createAsset: ReturnType<typeof createAsset>;
    readonly createFixedIncomeAsset: ReturnType<typeof createFixedIncomeAsset>;
    readonly updateAsset: ReturnType<typeof updateAsset>;
    readonly archiveAsset: ReturnType<typeof archiveAsset>;
    readonly deleteAsset: ReturnType<typeof deleteAsset>;
    readonly setManualPrice: ReturnType<typeof setManualPrice>;
    readonly listManualPrices: ReturnType<typeof listManualPrices>;
    readonly deleteManualPrice: ReturnType<typeof deleteManualPrice>;
  };
};

export type AssetController = {
  readonly list: RequestHandler;
  readonly detail: RequestHandler;
  readonly create: RequestHandler;
  readonly update: RequestHandler;
  readonly archive: RequestHandler;
  readonly remove: RequestHandler;
  readonly setManualPrice: RequestHandler;
  readonly listManualPrices: RequestHandler;
  readonly deleteManualPrice: RequestHandler;
};

type AssetQuery = {
  readonly search?: string;
  readonly origin?: 'market' | 'manual';
  readonly include_archived: boolean;
};

export const createAssetController = (deps: AssetDeps): AssetController => ({
  list: async (request, response) => {
    const query = validatedQuery<AssetQuery>(request);
    const result = await deps.usecases.listAssets({
      search: query?.search,
      origin: query?.origin,
      includeArchived: query?.include_archived === true,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ assets: result.value });
  },

  detail: async (request, response) => {
    const result = await deps.usecases.getAsset(String(request.params['asset_id']));

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ asset: result.value });
  },

  /**
   * O ativo listado vem da base de mercado; o título bancário é cadastrado com
   * emissor, indexador e taxa, e aí o código interno e o nome exibido são
   * gerados — ninguém quer digitar "CDB Banco C 10/2028 · 112% CDI" a cada
   * aplicação.
   */
  create: async (request, response) => {
    const body = request.body as CreateAssetBody;

    const result =
      body.origin === 'manual'
        ? await deps.usecases.createFixedIncomeAsset({
            kind: body.kind,
            issuer_id: body.issuer_id,
            indexer: body.indexer,
            rate: body.rate,
            issued_at: body.issued_at,
            maturity_date: body.maturity_date,
            liquidity: body.liquidity,
            liquidity_days: body.liquidity_days,
            tax_regime: body.tax_regime,
            name: body.name,
            category_id: body.category_id,
          })
        : await deps.usecases.createAsset({
            ticker: body.ticker,
            name: body.name,
            origin: 'market',
            b3_type: body.b3_type,
            category_id: body.category_id,
            sector: body.sector,
            price_source: body.price_source,
            maturity_date: body.maturity_date,
            indexer: body.indexer,
            rate: body.rate,
          });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(201).json({ asset: result.value, message: 'Ativo cadastrado' });
  },

  update: async (request, response) => {
    const result = await deps.usecases.updateAsset(
      String(request.params['asset_id']),
      request.body as UpdateAssetBody,
      { origin_request_id: request.requestId },
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ asset: result.value, message: 'Ativo atualizado' });
  },

  archive: async (request, response) => {
    const { archived } = request.body as { archived: boolean };
    const result = await deps.usecases.archiveAsset(
      String(request.params['asset_id']),
      archived,
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      asset: result.value,
      message: archived ? 'Ativo arquivado' : 'Ativo reativado',
    });
  },

  remove: async (request, response) => {
    const result = await deps.usecases.deleteAsset(String(request.params['asset_id']));

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ result: result.value, message: 'Ativo excluído' });
  },

  /**
   * Preço manual: vale até a fonte automática voltar a responder para aquele
   * ativo, e aparece marcado como manual nas tabelas enquanto vale.
   */
  setManualPrice: async (request, response) => {
    const body = request.body as SetManualPriceBody;

    const result = await deps.usecases.setManualPrice({
      asset_id: String(request.params['asset_id']),
      price_date: body.price_date,
      price: body.price,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      manual_price: result.value.manual_price,
      preview: result.value.preview,
      message: 'Preço manual salvo',
    });
  },

  listManualPrices: async (request, response) => {
    const result = await deps.usecases.listManualPrices(
      String(request.params['asset_id']),
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ manual_prices: result.value });
  },

  deleteManualPrice: async (request, response) => {
    const result = await deps.usecases.deleteManualPrice(
      String(request.params['asset_id']),
      String(request.params['price_date']),
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ message: 'Preço manual removido' });
  },
});
