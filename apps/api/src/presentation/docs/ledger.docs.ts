import {
  createContributionSchema,
  createRedemptionSchema,
  errorResponseSchema,
} from '@patrimonio/contracts';
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
  {
    method: 'post',
    path: '/ledger/resgates',
    tag: TAG,
    summary: 'Resgate: carteira → conta, com despesa ligada opcional',
    request: createRedemptionSchema,
    responses: {
      201: {
        description:
          'Gravado. Credita a conta, reduz a posição e, com `linked_expense`, grava a despesa do mesmo dia e valor ligada pelo `event_id`. `?preview=true` devolve só o efeito.',
        schema: z.object({
          amount: z.string(),
          account,
          expense_id: z.string().nullable(),
          event_id: z.string().nullable(),
        }),
      },
      200: {
        description: 'Mesma `Idempotency-Key` de novo: nada foi gravado.',
        schema: z.object({ replayed: z.boolean() }),
      },
      422: {
        description: 'Regra violada: `RESGATE_ACIMA_DA_POSICAO` ou `DATA_FUTURA`.',
        schema: errorResponseSchema,
      },
    },
  },
];
