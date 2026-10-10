import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  nonNegativeDecimal,
  optionalText,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';
import { payoutKindSchema, transactionPreviewSchema } from './transaction.schema.js';

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

/**
 * O mesmo corpo da gravação: o preview roda o mesmo cálculo — quantidade na
 * data-com, bruto, IR retido — e não grava nada.
 */
export const previewPayoutSchema = createPayoutSchema;

/**
 * O que o modal de provento mostra antes de salvar. A quantidade não é
 * digitada: ela vem dos lançamentos na data-com, e o bruto e o IR retido vêm do
 * mesmo cálculo que a gravação usa.
 */
export const payoutPreviewSchema = z.object({
  preview: transactionPreviewSchema,
  quantity_at_record_date: decimalString,
  unit_price: decimalString,
  gross_amount: decimalString,
  tax_withheld: decimalString,
  net_amount: decimalString,
});

export type PayoutPreviewResource = z.infer<typeof payoutPreviewSchema>;

export type CreatePayoutBody = z.infer<typeof createPayoutSchema>['body'];
