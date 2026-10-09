import { CORPORATE_EVENT_KINDS } from '@patrimonio/domain';
import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';

export const corporateEventKindSchema = z.enum(CORPORATE_EVENT_KINDS);

export const corporateEventResourceSchema = z.object({
  id: uuid,
  asset_id: uuid,
  kind: corporateEventKindSchema,
  record_date: dateOnly,
  ratio_from: decimalString,
  ratio_to: decimalString,
  confirmed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Registrar não aplica: o evento fica aguardando confirmação. Aplicar sozinho
 * um desdobramento com data errada reescreveria preço médio e resultado de todo
 * o histórico, e desfazer custa mais que um clique.
 */
export const registerCorporateEventSchema = z.object({
  body: z.object({
    asset_id: uuid,
    kind: corporateEventKindSchema,
    record_date: dateOnly,
    ratio_from: positiveDecimal,
    ratio_to: positiveDecimal,
  }),
});

export const listCorporateEventsSchema = z.object({
  query: z.object({
    asset_id: uuid.optional(),
    pending: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  }),
});

export const confirmCorporateEventSchema = z.object({
  params: z.object({ event_id: uuid }),
  body: z.object({}).optional(),
});

export type CorporateEventResource = z.infer<typeof corporateEventResourceSchema>;
export type RegisterCorporateEventBody = z.infer<
  typeof registerCorporateEventSchema
>['body'];
