import { z } from 'zod';

import { assetResourceSchema } from '../asset/asset.schema.js';
import { dateOnly, decimalString } from '../support/primitives.schema.js';
import { payoutKindSchema, transactionKindSchema } from './transaction.schema.js';

/**
 * Uma linha de texto: `compra 100 itub4 36,84 ontem`. A interpretação volta em
 * pastilhas, e texto ambíguo não salva — a resposta diz o que falta.
 */
export const interpretTransactionSchema = z.object({
  body: z.object({ text: z.string().trim().min(1).max(200) }),
});

export const textInterpretationSchema = z.object({
  text: z.string(),
  kind: transactionKindSchema.nullable(),
  payout_kind: payoutKindSchema.nullable(),
  ticker: z.string().nullable(),
  quantity: decimalString.nullable(),
  unit_price: decimalString.nullable(),
  trade_date: dateOnly.nullable(),
  total_amount: decimalString.nullable(),
  chips: z.array(
    z.object({
      field: z.enum(['kind', 'asset', 'quantity', 'unit_price', 'trade_date', 'total']),
      label: z.string(),
      value: z.string(),
    }),
  ),
  missing: z.array(z.string()),
  ambiguous: z.boolean(),
  asset: assetResourceSchema.nullable(),
  candidates: z.array(assetResourceSchema),
});

export type InterpretTransactionBody = z.infer<typeof interpretTransactionSchema>['body'];
