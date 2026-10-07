import { REBALANCE_MODES, RECALC_STATUSES } from '@patrimonio/domain';
import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  name,
  optionalText,
  percentString,
  uuid,
} from '../support/primitives.schema.js';

/**
 * O `web` itera os enums de `domain` em vez de repetir as opções: acrescentar
 * um modo de rebalanceamento muda um lugar só.
 */
export const rebalanceModeSchema = z.enum(REBALANCE_MODES);
export const recalcStatusSchema = z.enum(RECALC_STATUSES);

export const strategyTargetResourceSchema = z.object({
  category_id: uuid,
  target_pct: percentString,
});

export const portfolioResourceSchema = z.object({
  id: uuid,
  name: z.string(),
  purpose: z.string().nullable(),
  benchmark_id: uuid.nullable(),
  tolerance_pp: decimalString,
  max_asset_weight_pct: decimalString.nullable(),
  rebalance_mode: rebalanceModeSchema,
  review_every_months: z.number().int().nullable(),
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
  purpose: optionalText.optional(),
  benchmark_id: uuid.nullable().optional(),
  tolerance_pp: percentString.optional(),
  max_asset_weight_pct: percentString.nullable().optional(),
  rebalance_mode: rebalanceModeSchema.optional(),
  review_every_months: z.number().int().positive().nullable().optional(),
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
