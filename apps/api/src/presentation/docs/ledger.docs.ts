import { createContributionSchema, errorResponseSchema } from '@patrimonio/contracts';
import { z } from 'zod';

import type { RouteDoc } from './route-doc.js';

const TAG = 'Livro';

const account = z
  .object({ account_id: z.string(), before: z.string(), after: z.string() })
  .nullable();

export const LEDGER_ROUTE_DOCS: readonly RouteDoc[] = [
  {
    method: 'post',
    path: '/ledger/aportes',
    tag: TAG,
    summary: 'Aporte: conta → carteira, as duas pernas na mesma transação',
    request: createContributionSchema,
    responses: {
      201: {
        description:
          'Gravado. A saída na conta e a compra na carteira nascem juntas, ligadas pelo `event_id`, com o recálculo da carteira na outbox dentro da transação. `?preview=true` devolve só o efeito, sem gravar nem consumir a `Idempotency-Key`.',
        schema: z.object({
          amount: z.string(),
          account,
          event_id: z.string().nullable(),
        }),
      },
      200: {
        description: 'Mesma `Idempotency-Key` de novo: nada foi gravado.',
        schema: z.object({ replayed: z.boolean() }),
      },
      422: {
        description:
          'Regra violada: `APORTE_ORIGEM_CARTAO` (origem em cartão) ou `DATA_FUTURA` (RN-03).',
        schema: errorResponseSchema,
      },
    },
  },
];
