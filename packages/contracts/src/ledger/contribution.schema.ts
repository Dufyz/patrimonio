import { z } from 'zod';

import { newAssetSchema } from '../transaction/transaction.schema.js';
import { dateOnly, nonNegativeDecimal, uuid } from '../support/primitives.schema.js';

/** LIV-03 · Aporte: conta → carteira. `account_id` nulo é "Fora do app". */
export const contributionBodySchema = z
  .object({
    portfolio_id: uuid,
    institution_id: uuid,
    asset_id: uuid.optional(),
    asset: newAssetSchema.optional(),
    trade_date: dateOnly,
    settlement_date: dateOnly.optional(),
    quantity: nonNegativeDecimal,
    unit_price: nonNegativeDecimal,
    fees: nonNegativeDecimal.optional(),
    maturity_date: dateOnly.optional(),
    account_id: uuid.nullable(),
  })
  .refine((body) => body.asset_id === undefined || body.asset === undefined, {
    message: 'informe o ativo pelo id ou pelos dados do cadastro, não os dois',
    path: ['asset'],
  })
  .refine((body) => body.asset_id !== undefined || body.asset !== undefined, {
    message: 'o aporte precisa de um ativo',
    path: ['asset_id'],
  });

export const createContributionSchema = z.object({
  body: contributionBodySchema,
  query: z.object({ preview: z.enum(['true', 'false']).optional() }).optional(),
});

export type ContributionBody = z.infer<typeof contributionBodySchema>;
