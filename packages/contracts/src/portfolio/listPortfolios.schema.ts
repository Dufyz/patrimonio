import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';

export const listPortfoliosSchema = z.object({
  query: z.object({
    /** Arquivada sai da barra lateral, mas continua existindo no histórico. */
    include_archived: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  }),
});

export const getPortfolioSchema = z.object({
  params: z.object({ portfolio_id: uuid }),
});
