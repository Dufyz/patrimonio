import { z } from 'zod';

import { decimalString, uuid } from '../support/primitives.schema.js';

export const deleteTransactionSchema = z.object({
  params: z.object({ transaction_id: uuid }),
});

/** O desfazer vale por alguns segundos, e o token é o que o aviso carrega. */
export const undoDeletionSchema = z.object({
  params: z.object({ undo_id: uuid }),
});

const beforeAfter = z.object({ before: decimalString, after: decimalString });

/**
 * O impacto da exclusão, mostrado antes de confirmar. Os lançamentos
 * posteriores continuam valendo: é por isso que excluir uma compra antiga mexe
 * em tudo o que veio depois dela.
 */
export const deletionImpactSchema = z.object({
  basis: z.literal('cost'),
  position: z.object({
    quantity: beforeAfter,
    avg_price: beforeAfter,
    cost_basis: beforeAfter,
  }),
  cash: beforeAfter,
  portfolio_cost_basis: beforeAfter,
  realized_result: beforeAfter,
});
