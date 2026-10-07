import { z } from 'zod';

import {
  dateOnly,
  nonNegativeDecimal,
  optionalText,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';

/**
 * Dinheiro entrando ou saindo da carteira. A origem muda o significado: de fora
 * do app é aporte e conta no gráfico de origem do crescimento; de outra
 * carteira é transferência, e o patrimônio total não muda — só a leitura por
 * propósito.
 */
export const createCashMovementSchema = z.object({
  body: z
    .object({
      kind: z.enum(['deposit', 'withdrawal']),
      portfolio_id: uuid,
      institution_id: uuid,
      trade_date: dateOnly,
      settlement_date: dateOnly.optional(),
      amount: positiveDecimal,
      fees: nonNegativeDecimal.optional(),
      note: optionalText.optional(),
      source: z.enum(['external', 'other_portfolio']).default('external'),
      from_portfolio_id: uuid.optional(),
    })
    .refine(
      (body) => body.source !== 'other_portfolio' || body.from_portfolio_id !== undefined,
      {
        message: 'dinheiro vindo de outra carteira precisa da carteira de origem',
        path: ['from_portfolio_id'],
      },
    ),
});

export type CreateCashMovementBody = z.infer<typeof createCashMovementSchema>['body'];
