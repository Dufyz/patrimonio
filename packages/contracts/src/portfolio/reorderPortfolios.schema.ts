import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';

/** A nova ordem da barra lateral: os ids na sequência desejada. */
export const reorderPortfoliosSchema = z.object({
  body: z.object({ ids: z.array(uuid).min(1).max(200) }),
});

export type ReorderPortfoliosBody = z.infer<typeof reorderPortfoliosSchema>['body'];
