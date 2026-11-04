import { z } from 'zod';

import { corporateEventPreviewBodySchema } from '../corporate_event/corporateEventPreview.schema.js';
import { transactionWritableSchema } from './transaction.schema.js';

/**
 * O mesmo corpo da gravação. O preview roda o mesmo plano em modo que não
 * grava: os números são idênticos, campo a campo, e nada é criado — nem o
 * cadastro de um ticker novo. Um evento corporativo também passa por aqui: o
 * corpo com `kind: 'corporate_event'` devolve o efeito por carteira.
 */
export const previewTransactionSchema = z.object({
  body: z.union([corporateEventPreviewBodySchema, transactionWritableSchema]),
});

export type PreviewTransactionBody = z.infer<typeof transactionWritableSchema>;
