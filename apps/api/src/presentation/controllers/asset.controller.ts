import type {
  archiveAsset,
  createAsset,
  deleteAsset,
  getAsset,
  listAssets,
  updateAsset,
} from '@patrimonio/application';
import type { CreateAssetBody, UpdateAssetBody } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

export type AssetDeps = {
  readonly usecases: {
    readonly listAssets: ReturnType<typeof listAssets>;
    readonly getAsset: ReturnType<typeof getAsset>;
    readonly createAsset: ReturnType<typeof createAsset>;
    readonly updateAsset: ReturnType<typeof updateAsset>;
    readonly archiveAsset: ReturnType<typeof archiveAsset>;
    readonly deleteAsset: ReturnType<typeof deleteAsset>;
  };
};

export type AssetController = {
  readonly list: RequestHandler;
  readonly detail: RequestHandler;
  readonly create: RequestHandler;
  readonly update: RequestHandler;
  readonly archive: RequestHandler;
  readonly remove: RequestHandler;
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

  create: async (request, response) => {
    const body = request.body as CreateAssetBody;

    const result = await deps.usecases.createAsset({
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
});
