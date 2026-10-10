import { positionsResourceSchema } from '@patrimonio/contracts';
import type { PositionsResource } from '@patrimonio/contracts';
import type { PositionGroupBy } from '@patrimonio/domain';

import { request } from './client.js';

/**
 * T-02 · As posições do recorte.
 *
 * Todo filtro vai para a `api`. Filtrar no navegador seria mais rápido de
 * escrever e quebraria o subtotal na primeira pastilha clicada: o grupo somado
 * lá descreveria linhas que a tela escondeu.
 */
export type PositionsRequest = {
  readonly portfolioId: string;
  readonly groupBy: PositionGroupBy;
  readonly search: string;
  readonly categoryId: string | null;
};

export const positionsQuery = (input: PositionsRequest): URLSearchParams => {
  const params = new URLSearchParams();

  params.set('portfolio_id', input.portfolioId);
  params.set('group_by', input.groupBy);
  if (input.search.trim() !== '') params.set('search', input.search.trim());
  if (input.categoryId !== null) params.set('category_id', input.categoryId);

  return params;
};

export const fetchPositions = async (
  input: PositionsRequest,
  signal?: AbortSignal,
): Promise<PositionsResource> =>
  request(`/api/positions?${positionsQuery(input).toString()}`, positionsResourceSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
