import { z } from 'zod';

import {
  dateOnly,
  nonNegativeDecimal,
  optionalText,
  uuid,
} from '../support/primitives.schema.js';

/**
 * Edição parcial: o que não vem no corpo não é tocado. O tipo do lançamento não
 * muda aqui — virar outro tipo é excluir e lançar de novo, e o preview dessa
 * mudança seria mentira.
 */
export const updateTransactionSchema = z.object({
  params: z.object({ transaction_id: uuid }),
  body: z.object({
    portfolio_id: uuid.optional(),
    institution_id: uuid.optional(),
    asset_id: uuid.optional(),
    trade_date: dateOnly.optional(),
    settlement_date: dateOnly.optional(),
    quantity: nonNegativeDecimal.optional(),
    unit_price: nonNegativeDecimal.optional(),
    fees: nonNegativeDecimal.optional(),
    tax_withheld: nonNegativeDecimal.optional(),
    note: optionalText.optional(),
  }),
});

/** O mesmo corpo, sem gravar: é o que o modal de edição mostra. */
export const previewUpdateSchema = updateTransactionSchema;

export type UpdateTransactionBody = z.infer<typeof updateTransactionSchema>['body'];
