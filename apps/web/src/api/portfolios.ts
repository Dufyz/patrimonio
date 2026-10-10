import { listPortfoliosResponseSchema } from '@patrimonio/contracts';
import type { PortfolioResource } from '@patrimonio/contracts';

import { request } from './client.js';

export type PortfolioList = {
  readonly portfolios: readonly PortfolioResource[];
  /** O valor de cada carteira no último fechamento, por identificador. */
  readonly values: Readonly<Record<string, string>>;
};

/** As carteiras da barra lateral, em ordem de exibição, com o valor de cada uma. */
export const fetchPortfolios = async (signal?: AbortSignal): Promise<PortfolioList> =>
  request('/api/portfolios', listPortfoliosResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  });
