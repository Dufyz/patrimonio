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
  /** Qualquer uma delas; vazio não filtra. */
  readonly categoryIds: readonly string[];
  readonly institutionIds: readonly string[];
};

export const positionsQuery = (input: PositionsRequest): URLSearchParams => {
  const params = new URLSearchParams();

  params.set('portfolio_id', input.portfolioId);
  params.set('group_by', input.groupBy);
  if (input.search.trim() !== '') params.set('search', input.search.trim());
  if (input.categoryIds.length > 0)
    params.set('category_id', input.categoryIds.join(','));
  if (input.institutionIds.length > 0) {
    params.set('institution_id', input.institutionIds.join(','));
  }

  return params;
};

export const fetchPositions = async (
  input: PositionsRequest,
  signal?: AbortSignal,
): Promise<PositionsResource> =>
  request(`/api/positions?${positionsQuery(input).toString()}`, positionsResourceSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
