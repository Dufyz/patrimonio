import { either } from '@patrimonio/shared';

import type { PositionViewRepository } from '../../interfaces/position_view.repository.js';

/**
 * Posições encerradas da carteira. Não calcula: o banco soma em `numeric`.
 */
export type ListClosedPositionsInput = {
  readonly portfolioId: string | null;
  readonly search: string | null;
};

export type ListClosedPositionsDeps = { readonly positionViews: PositionViewRepository };

export const listClosedPositions = (deps: ListClosedPositionsDeps) =>
  either(async function* (input: ListClosedPositionsInput) {
    const rows = yield* await deps.positionViews.closed({
      portfolioId: input.portfolioId,
      search: input.search,
    });

    return {
      portfolio_id: input.portfolioId,
      positions: rows.map((row) => ({ ...row })),
    };
  });
