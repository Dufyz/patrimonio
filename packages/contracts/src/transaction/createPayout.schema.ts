import { z } from 'zod';

import {
  dateOnly,
  nonNegativeDecimal,
  optionalText,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';
import { payoutKindSchema } from './transaction.schema.js';

/**
 * A quantidade não entra aqui de propósito: ela é calculada pelos lançamentos
 * na data-com. O valor vem por ação ou como total, e o líquido de JCP sai do
 * bruto com o IR retido.
 */
export const createPayoutSchema = z.object({
  body: z
    .object({
      portfolio_id: uuid,
      institution_id: uuid,
      asset_id: uuid,
      payout_kind: payoutKindSchema,
      record_date: dateOnly,
      payment_date: dateOnly,
      amount_per_share: positiveDecimal.optional(),
      gross_amount: positiveDecimal.optional(),
      tax_withheld: nonNegativeDecimal.optional(),
      note: optionalText.optional(),
      /** Sem isso, o que já venceu entra confirmado e o futuro fica a receber. */
      confirmed: z.boolean().optional(),
    })
    .refine(
      (body) => body.amount_per_share !== undefined || body.gross_amount !== undefined,
      {
        message: 'informe o valor por ação ou o valor bruto',
        path: ['amount_per_share'],
      },
    ),
});

export type CreatePayoutBody = z.infer<typeof createPayoutSchema>['body'];
