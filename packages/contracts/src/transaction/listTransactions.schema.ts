import { z } from 'zod';

import { dateOnly, pagination, uuid } from '../support/primitives.schema.js';
import { transactionKindSchema } from './transaction.schema.js';

/** O extrato do livro: os filtros são combináveis, como a tela os combina. */
export const listTransactionsSchema = z.object({
  query: pagination.extend({
    portfolio_id: uuid.optional(),
    asset_id: uuid.optional(),
    institution_id: uuid.optional(),
    kind: transactionKindSchema.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    pending_payouts: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  }),
});

export const getTransactionSchema = z.object({
  params: z.object({ transaction_id: uuid }),
});
