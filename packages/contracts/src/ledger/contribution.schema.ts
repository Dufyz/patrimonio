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

/** LIV-04 · Resgate: carteira → conta, com despesa ligada opcional. */
export const redemptionBodySchema = z
  .object({
    portfolio_id: uuid,
    institution_id: uuid,
    asset_id: uuid,
    trade_date: dateOnly,
    settlement_date: dateOnly.optional(),
    quantity: nonNegativeDecimal,
    unit_price: nonNegativeDecimal,
    fees: nonNegativeDecimal.optional(),
    /** A conta que recebe; nulo é "Fora do app". */
    account_id: uuid.nullable(),
    linked_expense: z
      .object({
        category_id: uuid,
        description: z.string().trim().min(1).max(120).optional(),
      })
      .optional(),
  })
  .refine((body) => body.linked_expense === undefined || body.account_id !== null, {
    message: 'para gerar a despesa ligada, escolha a conta que recebe',
    path: ['account_id'],
  });

export const createRedemptionSchema = z.object({
  body: redemptionBodySchema,
  query: z.object({ preview: z.enum(['true', 'false']).optional() }).optional(),
});

export type RedemptionBody = z.infer<typeof redemptionBodySchema>;
export type ContributionBody = z.infer<typeof contributionBodySchema>;
