import { either, failure } from '@patrimonio/shared';

import { BadRequestError } from '../../errors/app-error.js';
import type { PortfolioRepository } from '../../interfaces/portfolio.repository.js';

export type ReorderPortfoliosDeps = { readonly portfolios: PortfolioRepository };

/**
 * A ordem da barra lateral é a ordem em que os ids chegam: uma única consulta
 * grava todas as posições, então a lista nunca fica meio reordenada (CFG-05).
 */
export const reorderPortfolios = (deps: ReorderPortfoliosDeps) =>
  either(async function* (ids: readonly string[]) {
    if (new Set(ids).size !== ids.length) {
      return yield* failure(new BadRequestError('A ordem repete uma carteira'));
    }
    const written = yield* await deps.portfolios.reorder(ids);
    if (written !== ids.length) {
      return yield* failure(
        new BadRequestError('A ordem cita uma carteira que não existe'),
      );
    }
    return { reordered: written };
  });
