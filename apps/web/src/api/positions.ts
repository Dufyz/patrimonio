import {
  closedPositionsResourceSchema,
  positionsResourceSchema,
} from '@patrimonio/contracts';
import type { ClosedPositionsResource, PositionsResource } from '@patrimonio/contracts';
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
  /** Nulo soma todas as carteiras. */
  readonly portfolioId: string | null;
  readonly groupBy: PositionGroupBy;
  readonly search: string;
  /** Qualquer uma delas; vazio não filtra. */
  readonly categoryIds: readonly string[];
  readonly institutionIds: readonly string[];
};

export const positionsQuery = (input: PositionsRequest): URLSearchParams => {
  const params = new URLSearchParams();

  if (input.portfolioId !== null) params.set('portfolio_id', input.portfolioId);
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

export const fetchClosedPositions = async (
  portfolioId: string | null,
  search: string,
  signal?: AbortSignal,
): Promise<ClosedPositionsResource> => {
  const params = new URLSearchParams();
  if (portfolioId !== null) params.set('portfolio_id', portfolioId);
  if (search.trim() !== '') params.set('search', search.trim());

  return request(
    `/api/positions/closed?${params.toString()}`,
    closedPositionsResourceSchema,
    { ...(signal === undefined ? {} : { signal }) },
  );
};
