import { either, failure } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { PortfolioRepository } from '../../interfaces/portfolio.repository.js';

export type ArchivePortfolioDeps = { readonly portfolios: PortfolioRepository };

/**
 * Arquivar tira da barra lateral e mantém o histórico. É o caminho para a
 * carteira que acabou: o patrimônio passado continua certo, e o nome volta a
 * ficar livre porque o índice de unicidade é parcial.
 */
export const setPortfolioArchived = (deps: ArchivePortfolioDeps) =>
  either(async function* (id: string, archived: boolean) {
    const portfolio = yield* await deps.portfolios.setArchived(id, archived);

    if (portfolio === null) {
      return yield* failure(new NotFoundError(`Carteira ${id} não encontrada`));
    }

    return portfolio;
  });
