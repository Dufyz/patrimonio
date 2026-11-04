import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';
import { corporateEventKindSchema } from './corporateEvent.schema.js';

const beforeAfter = z.object({ before: decimalString, after: decimalString });

/**
 * O evento antes de registrar: em `/transactions/preview`, ao lado do lançamento
 * comum, e reconhecido por `kind: 'corporate_event'`. A razão é lida como
 * "cada `ratio_from` papéis viram `ratio_to`": desdobramento aumenta a
 * quantidade, grupamento diminui, bonificação aumenta.
 */
export const corporateEventPreviewBodySchema = z
  .object({
    kind: z.literal('corporate_event'),
    event_kind: corporateEventKindSchema,
    asset_id: uuid,
    record_date: dateOnly,
    ratio_from: positiveDecimal,
    ratio_to: positiveDecimal,
  })
  .refine(
    (body) => {
      const from = Number(body.ratio_from);
      const to = Number(body.ratio_to);

      return body.event_kind === 'reverse_split' ? to < from : to > from;
    },
    {
      message:
        'o fator não combina com o tipo: grupamento reduz a quantidade; desdobramento e bonificação a aumentam',
      path: ['ratio_to'],
    },
  );

/**
 * O efeito por carteira: confirmar aplica o evento em todas as carteiras que
 * tinham posição na data-com. O custo total não muda.
 */
export const corporateEventPreviewSchema = z.object({
  kind: z.literal('corporate_event'),
  record_date: dateOnly,
  portfolios: z.array(
    z.object({
      portfolio_id: uuid,
      portfolio_name: z.string(),
      quantity: beforeAfter,
      avg_price: beforeAfter,
      cost_basis: beforeAfter,
    }),
  ),
});

export type CorporateEventPreviewBody = z.infer<typeof corporateEventPreviewBodySchema>;
export type CorporateEventPreviewResource = z.infer<typeof corporateEventPreviewSchema>;
