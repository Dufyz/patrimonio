import { either, failure } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { PortfolioRepository } from '../../interfaces/portfolio.repository.js';

export type ListPortfoliosDeps = { readonly portfolios: PortfolioRepository };

export const listPortfolios = (deps: ListPortfoliosDeps) =>
  either(async function* (options: { readonly includeArchived: boolean }) {
    return yield* await deps.portfolios.list(options);
  });

export const getPortfolio = (deps: ListPortfoliosDeps) =>
  either(async function* (id: string) {
    const portfolio = yield* await deps.portfolios.findById(id);

    if (portfolio === null) {
      return yield* failure(new NotFoundError(`Carteira ${id} não encontrada`));
    }

    const targets = yield* await deps.portfolios.listTargets(id);

    return { portfolio, targets };
  });
