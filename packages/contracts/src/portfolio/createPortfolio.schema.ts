import { z } from 'zod';

import { portfolioWritableSchema } from './portfolio.schema.js';

export const createPortfolioSchema = z.object({
  body: portfolioWritableSchema,
});

export type CreatePortfolioBody = z.infer<typeof portfolioWritableSchema>;
