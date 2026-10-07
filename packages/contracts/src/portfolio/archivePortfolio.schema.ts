import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';

/** Arquivar tira da barra lateral, mantém o histórico e libera o nome. */
export const archivePortfolioSchema = z.object({
  params: z.object({ portfolio_id: uuid }),
  body: z.object({ archived: z.boolean() }),
});
