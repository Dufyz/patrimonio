import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  nonNegativeDecimal,
  uuid,
} from '../support/primitives.schema.js';

export const manualPriceResourceSchema = z.object({
  asset_id: uuid,
  price_date: dateOnly,
  price: decimalString,
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * O preço definido à mão vale até a fonte automática voltar a responder para
 * aquele ativo, e nas tabelas ele aparece marcado como manual.
 */
export const setManualPriceSchema = z.object({
  params: z.object({ asset_id: uuid }),
  body: z.object({
    price_date: dateOnly,
    price: nonNegativeDecimal,
  }),
});

export const listManualPricesSchema = z.object({
  params: z.object({ asset_id: uuid }),
});

export const deleteManualPriceSchema = z.object({
  params: z.object({ asset_id: uuid, price_date: dateOnly }),
});

export const manualPricePreviewSchema = z.object({
  quantity: decimalString,
  previous_price: decimalString.nullable(),
  previous_source: z.enum(['manual', 'cost']),
  price: decimalString,
  position_value: z.object({ before: decimalString, after: decimalString }),
});

export type SetManualPriceBody = z.infer<typeof setManualPriceSchema>['body'];
