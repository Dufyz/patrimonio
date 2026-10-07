import {
  confirmCorporateEventSchema,
  corporateEventResourceSchema,
  errorResponseSchema,
  listCorporateEventsSchema,
  registerCorporateEventSchema,
  transactionResourceSchema,
} from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Eventos corporativos';

export const CORPORATE_EVENT_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'get',
    path: '/corporate-events',
    tag: TAG,
    summary: 'Eventos anunciados e aplicados',
    request: listCorporateEventsSchema,
    responses: {
      200: {
        description: 'Com pending=true, os que esperam confirmação.',
        schema: z.object({ events: z.array(corporateEventResourceSchema) }),
      },
    },
  },
  {
    method: 'post',
    path: '/corporate-events',
    tag: TAG,
    summary: 'Registrar um evento, sem aplicá-lo',
    request: registerCorporateEventSchema,
    responses: {
      201: {
        description:
          'Registrado e aguardando confirmação. Reanunciar o mesmo evento não cria uma segunda linha.',
        schema: z.object({
          event: corporateEventResourceSchema,
          message: z.string(),
        }),
      },
      404: { description: 'Ativo não encontrado.', schema: errorResponseSchema },
    },
  },
  {
    method: 'post',
    path: '/corporate-events/:event_id/confirm',
    tag: TAG,
    summary: 'Aplicar o evento às carteiras que tinham posição na data-com',
    request: confirmCorporateEventSchema,
    responses: {
      200: {
        description:
          'Aplicado: quantidade e preço médio mudam, o custo total não. O recálculo recomeça da data-com.',
        schema: z.object({
          event: corporateEventResourceSchema,
          transactions: z.array(transactionResourceSchema),
          portfolios: z.array(z.string()),
          recalculation: z.array(
            z.object({
              job_id: z.string(),
              dedupe_key: z.string(),
              already_queued: z.boolean(),
            }),
          ),
          message: z.string(),
        }),
      },
      400: {
        description: 'Nenhuma carteira tinha posição no ativo na data-com.',
        schema: errorResponseSchema,
      },
      404: { description: 'Evento não encontrado.', schema: errorResponseSchema },
      409: { description: 'Este evento já foi aplicado.', schema: errorResponseSchema },
    },
  },
];
