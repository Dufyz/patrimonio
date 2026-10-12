import { overviewSchema } from '@patrimonio/contracts';
import type { OverviewResource } from '@patrimonio/contracts';

import { request } from './client.js';

/**
 * A tela de abertura inteira, numa chamada: `GET /api/overview` responde o
 * cabeçalho, a evolução, a composição, as maiores posições e as pendências.
 *
 * A validação é pelo schema que a própria `api` usa para montar a resposta —
 * um campo renomeado quebra o typecheck dos dois lados no mesmo commit.
 */
export type OverviewQuery = {
  /** Nulo é o consolidado: a carteira é filtro, não rota. */
  readonly portfolioId: string | null;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
};

export const fetchOverview = async (
  query: OverviewQuery,
  signal?: AbortSignal,
): Promise<OverviewResource> => {
  const search = new URLSearchParams();
  if (query.portfolioId !== null) search.set('portfolio_id', query.portfolioId);
  if (query.from !== undefined) search.set('from', query.from);
  if (query.to !== undefined) search.set('to', query.to);

  const suffix = search.toString();

  return request(
    `/api/overview${suffix === '' ? '' : `?${suffix}`}`,
    overviewSchema,
    signal === undefined ? {} : { signal },
  );
};
