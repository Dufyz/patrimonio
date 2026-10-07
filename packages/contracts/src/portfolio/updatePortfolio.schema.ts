import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';
import { portfolioWritableSchema } from './portfolio.schema.js';

/** Edição parcial: o que não vem no corpo não é tocado. */
export const updatePortfolioSchema = z.object({
  params: z.object({ portfolio_id: uuid }),
  body: portfolioWritableSchema.partial(),
});

export type UpdatePortfolioBody = z.infer<typeof updatePortfolioSchema>['body'];
