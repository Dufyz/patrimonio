import { z } from 'zod';

import { transactionWritableSchema } from './transaction.schema.js';

/**
 * O mesmo corpo da gravação. O preview roda o mesmo plano em modo que não
 * grava: os números são idênticos, campo a campo, e nada é criado — nem o
 * cadastro de um ticker novo.
 */
export const previewTransactionSchema = z.object({
  body: transactionWritableSchema,
});

export type PreviewTransactionBody = z.infer<typeof transactionWritableSchema>;
