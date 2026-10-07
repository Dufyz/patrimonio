import type {
  createPortfolio,
  deletePortfolio,
  getPortfolio,
  listPortfolios,
  putStrategy,
  setPortfolioArchived,
  updatePortfolio,
} from '@patrimonio/application';
import type {
  CreatePortfolioBody,
  DeletePortfolioBody,
  PutStrategyBody,
  UpdatePortfolioBody,
} from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

export type PortfolioDeps = {
  readonly usecases: {
    readonly createPortfolio: ReturnType<typeof createPortfolio>;
    readonly updatePortfolio: ReturnType<typeof updatePortfolio>;
    readonly setPortfolioArchived: ReturnType<typeof setPortfolioArchived>;
    readonly deletePortfolio: ReturnType<typeof deletePortfolio>;
    readonly listPortfolios: ReturnType<typeof listPortfolios>;
    readonly getPortfolio: ReturnType<typeof getPortfolio>;
    readonly putStrategy: ReturnType<typeof putStrategy>;
  };
};

export type PortfolioController = {
  readonly create: RequestHandler;
  readonly update: RequestHandler;
  readonly archive: RequestHandler;
  readonly remove: RequestHandler;
  readonly list: RequestHandler;
  readonly detail: RequestHandler;
  readonly getStrategy: RequestHandler;
  readonly putStrategy: RequestHandler;
};

const portfolioId = (value: unknown): string => String(value);

export const createPortfolioController = (deps: PortfolioDeps): PortfolioController => ({
  create: async (request, response) => {
    const body = request.body as CreatePortfolioBody;
    const result = await deps.usecases.createPortfolio(body);

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(201).json({ portfolio: result.value, message: 'Carteira criada' });
  },

  update: async (request, response) => {
    const body = request.body as UpdatePortfolioBody;
    const result = await deps.usecases.updatePortfolio(
      portfolioId(request.params['portfolio_id']),
      body,
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response
      .status(200)
      .json({ portfolio: result.value, message: 'Carteira atualizada' });
  },

  archive: async (request, response) => {
    const { archived } = request.body as { archived: boolean };
    const result = await deps.usecases.setPortfolioArchived(
      portfolioId(request.params['portfolio_id']),
      archived,
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      portfolio: result.value,
      message: archived ? 'Carteira arquivada' : 'Carteira reativada',
    });
  },

  remove: async (request, response) => {
    const body = request.body as DeletePortfolioBody;
    const result = await deps.usecases.deletePortfolio(
      portfolioId(request.params['portfolio_id']),
      {
        confirm_name: body.confirm_name,
        transactions: body.transactions,
        destination_portfolio_id: body.destination_portfolio_id,
        origin_request_id: request.requestId,
      },
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ result: result.value, message: 'Carteira excluída' });
  },

  list: async (request, response) => {
    const query = validatedQuery<{ include_archived: boolean }>(request);
    const result = await deps.usecases.listPortfolios({
      includeArchived: query?.include_archived === true,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ portfolios: result.value });
  },

  detail: async (request, response) => {
    const result = await deps.usecases.getPortfolio(
      portfolioId(request.params['portfolio_id']),
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({
      portfolio: result.value.portfolio,
      allocation_targets: result.value.targets,
    });
  },

  getStrategy: async (request, response) => {
    const result = await deps.usecases.getPortfolio(
      portfolioId(request.params['portfolio_id']),
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ targets: result.value.targets });
  },

  putStrategy: async (request, response) => {
    const body = request.body as PutStrategyBody;
    const result = await deps.usecases.putStrategy(
      portfolioId(request.params['portfolio_id']),
      body.targets,
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ targets: result.value, message: 'Estratégia salva' });
  },
});
