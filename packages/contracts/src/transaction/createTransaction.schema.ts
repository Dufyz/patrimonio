import { z } from 'zod';

import { transactionWritableSchema } from './transaction.schema.js';

export const createTransactionSchema = z.object({
  body: transactionWritableSchema,
});

export type CreateTransactionBody = z.infer<typeof transactionWritableSchema>;
