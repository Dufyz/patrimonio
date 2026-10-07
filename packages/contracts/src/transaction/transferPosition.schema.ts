import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  optionalText,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';

/**
 * Mover uma posição de carteira sem vender. É reclassificação interna: o preço
 * médio é preservado nas duas pontas, não há resultado realizado nem imposto, e
 * o patrimônio total não muda.
 */
export const transferPositionSchema = z.object({
  body: z
    .object({
      from_portfolio_id: uuid,
      to_portfolio_id: uuid,
      asset_id: uuid,
      institution_id: uuid,
      trade_date: dateOnly,
      quantity: positiveDecimal.optional(),
      /** Mover tudo o que houver na data, sem precisar digitar a quantidade. */
      all: z.boolean().optional(),
      note: optionalText.optional(),
    })
    .refine((body) => body.quantity !== undefined || body.all === true, {
      message: 'informe a quantidade ou peça para mover tudo',
      path: ['quantity'],
    })
    .refine((body) => body.from_portfolio_id !== body.to_portfolio_id, {
      message: 'a carteira de origem e a de destino precisam ser diferentes',
      path: ['to_portfolio_id'],
    }),
});

export const previewTransferSchema = transferPositionSchema;

const beforeAfter = z.object({ before: decimalString, after: decimalString });

const side = z.object({
  portfolio_id: uuid,
  quantity: beforeAfter,
  avg_price: beforeAfter,
  cost_basis: beforeAfter,
  portfolio_cost_basis: beforeAfter,
});

export const transferPreviewSchema = z.object({
  basis: z.literal('cost'),
  quantity: decimalString,
  avg_price: decimalString,
  amount: decimalString,
  origin: side,
  destination: side,
  total: beforeAfter,
  /** Zero: a transferência preserva o patrimônio total. */
  total_change: decimalString,
  available_quantity: decimalString,
  oversold: z.boolean(),
});

export type TransferPositionBody = z.infer<typeof transferPositionSchema>['body'];
