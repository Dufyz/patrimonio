import { z } from 'zod';

import {
  dateOnly,
  nonNegativeDecimal,
  optionalText,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';

/**
 * Dinheiro entrando ou saindo da carteira: aporte ou resgate, vindo de fora do app.
 */
export const createCashMovementSchema = z.object({
  body: z.object({
    kind: z.enum(['deposit', 'withdrawal']),
    portfolio_id: uuid,
    institution_id: uuid,
    trade_date: dateOnly,
    settlement_date: dateOnly.optional(),
    amount: positiveDecimal,
    fees: nonNegativeDecimal.optional(),
    note: optionalText.optional(),
  }),
});

export type CreateCashMovementBody = z.infer<typeof createCashMovementSchema>['body'];
