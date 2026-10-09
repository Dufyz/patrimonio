import { listPortfoliosResponseSchema } from '@patrimonio/contracts';
import type { PortfolioResource } from '@patrimonio/contracts';

import { request } from './client.js';

/** As carteiras da barra lateral, em ordem de exibição. */
export const fetchPortfolios = async (
  signal?: AbortSignal,
): Promise<readonly PortfolioResource[]> =>
  request('/api/portfolios', listPortfoliosResponseSchema, {
    ...(signal === undefined ? {} : { signal }),
  }).then((body) => body.portfolios);
