import { B3_TYPES, PAYOUT_KINDS, TRANSACTION_KINDS } from '@patrimonio/domain';
import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  name,
  nonNegativeDecimal,
  optionalText,
  uuid,
} from '../support/primitives.schema.js';

export const transactionKindSchema = z.enum(TRANSACTION_KINDS);
export const payoutKindSchema = z.enum(PAYOUT_KINDS);

export const transactionResourceSchema = z.object({
  id: uuid,
  kind: transactionKindSchema,
  trade_date: dateOnly,
  settlement_date: dateOnly,
  portfolio_id: uuid,
  asset_id: uuid.nullable(),
  institution_id: uuid,
  quantity: decimalString,
  unit_price: decimalString,
  fees: decimalString,
  gross_amount: decimalString,
  tax_withheld: decimalString,
  net_amount: decimalString,
  payout_kind: payoutKindSchema.nullable(),
  expected_net_amount: decimalString.nullable(),
  record_date: dateOnly.nullable(),
  confirmed_at: z.string().nullable(),
  event_ratio_from: decimalString.nullable(),
  event_ratio_to: decimalString.nullable(),
  note: z.string().nullable(),
  idempotency_key: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const beforeAfter = z.object({ before: decimalString, after: decimalString });

/**
 * O efeito antes de salvar. Estes números saem do mesmo plano que grava — nunca
 * de uma aproximação própria da tela —, e `basis` diz sobre o que o peso foi
 * calculado enquanto o preço de mercado não entra.
 */
export const transactionPreviewSchema = z.object({
  basis: z.literal('cost'),
  total_amount: decimalString,
  net_amount: decimalString,
  position: z.object({
    quantity: beforeAfter,
    avg_price: beforeAfter,
    cost_basis: beforeAfter,
    weight_pct: beforeAfter,
  }),
  cash: beforeAfter,
  portfolio_cost_basis: beforeAfter,
  allocation: z
    .object({
      category_id: uuid,
      category_name: z.string().nullable(),
      current_pct: beforeAfter,
      target_pct: decimalString.nullable(),
      deviation_pp: beforeAfter.nullable(),
    })
    .nullable(),
  realized_result: decimalString.nullable(),
  oversold: z.boolean(),
});

/** O ativo que ainda não existe entra no próprio lançamento, sem cadastro. */
export const newAssetSchema = z.object({
  ticker: z.string().trim().min(1).max(20),
  name,
  b3_type: z.enum(B3_TYPES).optional(),
  sector: z.string().trim().max(120).optional(),
  category_id: uuid.nullable().optional(),
});

export const transactionWritableSchema = z
  .object({
    kind: transactionKindSchema,
    portfolio_id: uuid,
    institution_id: uuid,
    asset_id: uuid.optional(),
    asset: newAssetSchema.optional(),
    trade_date: dateOnly,
    /** Sugerida pelo tipo do ativo quando não vem, e sempre editável. */
    settlement_date: dateOnly.optional(),
    quantity: nonNegativeDecimal,
    unit_price: nonNegativeDecimal,
    /** Sugerida pela regra da instituição quando não vem. */
    fees: nonNegativeDecimal.optional(),
    tax_withheld: nonNegativeDecimal.optional(),
    payout_kind: payoutKindSchema.optional(),
    record_date: dateOnly.optional(),
    note: optionalText.optional(),
  })
  .refine((body) => body.asset_id === undefined || body.asset === undefined, {
    message: 'informe o ativo pelo id ou pelos dados do cadastro, não os dois',
    path: ['asset'],
  })
  .refine(
    (body) =>
      body.kind === 'deposit' ||
      body.kind === 'withdrawal' ||
      body.asset_id !== undefined ||
      body.asset !== undefined,
    { message: 'este tipo de lançamento precisa de um ativo', path: ['asset_id'] },
  )
  .refine((body) => body.kind !== 'payout' || body.payout_kind !== undefined, {
    message: 'provento precisa do tipo de provento',
    path: ['payout_kind'],
  });

export type TransactionResource = z.infer<typeof transactionResourceSchema>;
export type TransactionPreviewResource = z.infer<typeof transactionPreviewSchema>;
export type TransactionWritable = z.infer<typeof transactionWritableSchema>;
