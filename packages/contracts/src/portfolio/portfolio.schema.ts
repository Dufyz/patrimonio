import { RECALC_STATUSES } from '@patrimonio/domain';
import { z } from 'zod';

import {
  dateOnly,
  name,
  percentString,
  uuid,
} from '../support/primitives.schema.js';

/** O `web` itera o enum de `domain` em vez de repetir as opções. */
export const recalcStatusSchema = z.enum(RECALC_STATUSES);

export const strategyTargetResourceSchema = z.object({
  category_id: uuid,
  target_pct: percentString,
});

export const portfolioResourceSchema = z.object({
  id: uuid,
  name: z.string(),
  benchmark_id: uuid.nullable(),
  sort_order: z.number().int(),
  recalc_status: recalcStatusSchema,
  recalc_from_date: dateOnly.nullable(),
  recalc_error: z.string().nullable(),
  recalc_updated_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * O corpo aceito na escrita. `recalc_status` e as outras três colunas do
 * pipeline não entram: só a máquina de estados as escreve, e aceitar aqui seria
 * deixar a tela mentir sobre o estado do recálculo.
 */
export const portfolioWritableSchema = z.object({
  name,
  benchmark_id: uuid.nullable().optional(),
  sort_order: z.number().int().optional(),
  /**
   * O alvo entra junto porque é a mesma decisão: a carteira só fica consistente
   * quando a soma fecha 100 — ou zero, que é "sem estratégia definida".
   */
  allocation_targets: z.array(strategyTargetResourceSchema).optional(),
});

export type PortfolioResource = z.infer<typeof portfolioResourceSchema>;
export type StrategyTargetResource = z.infer<typeof strategyTargetResourceSchema>;
export type PortfolioWritable = z.infer<typeof portfolioWritableSchema>;
