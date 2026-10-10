import { performanceSchema } from '@patrimonio/contracts';
import type { PerformanceResource } from '@patrimonio/contracts';

import { request } from './client.js';

/**
 * A tela de Desempenho inteira, numa chamada: `GET /api/performance` responde o
 * gráfico contra benchmarks, as janelas, a grade mensal, a decomposição e as
 * tabelas por carteira e por classe — todas sobre o mesmo fechamento e a mesma
 * cota, porque cada uma pedindo o seu "hoje" faria as quatro discordarem.
 */
export type PerformanceQuery = {
  readonly portfolioId: string;
  /** Recorte do gráfico; as tabelas não dependem dele. */
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  /** Benchmarks além do da carteira, na ordem em que entram na tela. */
  readonly benchmarks?: readonly string[] | undefined;
};

export const fetchPerformance = async (
  query: PerformanceQuery,
  signal?: AbortSignal,
): Promise<PerformanceResource> => {
  const search = new URLSearchParams();
  search.set('portfolio_id', query.portfolioId);
  if (query.from !== undefined) search.set('from', query.from);
  if (query.to !== undefined) search.set('to', query.to);
  if (query.benchmarks !== undefined && query.benchmarks.length > 0) {
    search.set('benchmarks', query.benchmarks.join(','));
  }

  const suffix = search.toString();

  return request(
    `/api/performance${suffix === '' ? '' : `?${suffix}`}`,
    performanceSchema,
    signal === undefined ? {} : { signal },
  );
};
