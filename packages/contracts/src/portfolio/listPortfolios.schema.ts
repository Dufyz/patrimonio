import { z } from 'zod';

import { decimalString, uuid } from '../support/primitives.schema.js';
import { portfolioResourceSchema } from './portfolio.schema.js';

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

/**
 * O envelope da listagem. Ele mora aqui, e não na `api`, para o `web` validar a
 * resposta com o mesmo schema que a montou — sem precisar do zod por conta
 * própria nem repetir a forma do corpo.
 */
export const listPortfoliosResponseSchema = z.object({
  portfolios: z.array(portfolioResourceSchema),
  /** O valor de cada carteira no último fechamento, por identificador. */
  values: z.record(uuid, decimalString),
});
