import { z } from 'zod';

import {
  decimalString,
  optionalText,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';

/**
 * O provento previsto vira recebido. O valor pode chegar diferente do previsto,
 * e nesse caso o previsto fica guardado ao lado do recebido: a diferença
 * precisa aparecer, não sumir na edição.
 */
export const confirmPayoutSchema = z.object({
  params: z.object({ transaction_id: uuid }),
  body: z.object({
    net_amount: positiveDecimal.optional(),
    note: optionalText.optional(),
  }),
});

/** "Não foi pago": o provento sai do livro e o motivo fica registrado. */
export const dismissPayoutSchema = z.object({
  params: z.object({ transaction_id: uuid }),
  body: z.object({ reason: z.string().trim().min(1).max(500) }),
});

export const payoutDismissalResourceSchema = z.object({
  id: uuid,
  portfolio_id: uuid,
  asset_id: uuid.nullable(),
  payout_kind: z.string(),
  record_date: z.string(),
  payment_date: z.string(),
  expected_net_amount: decimalString,
  reason: z.string(),
  created_at: z.string(),
});

export type ConfirmPayoutBody = z.infer<typeof confirmPayoutSchema>['body'];
export type DismissPayoutBody = z.infer<typeof dismissPayoutSchema>['body'];
