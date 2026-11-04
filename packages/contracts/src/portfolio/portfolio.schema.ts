import { normalizeBenchmark, parseBenchmark, RECALC_STATUSES } from '@patrimonio/domain';
import { z } from 'zod';

import {
  dateOnly,
  name,
  percentString,
  uuid,
} from '../support/primitives.schema.js';

/** O `web` itera o enum de `domain` em vez de repetir as opções. */
export const recalcStatusSchema = z.enum(RECALC_STATUSES);

/**
 * O benchmark é um valor: `CDI`, `IPCA+6`, `110%CDI`. Quem digita pode escrever
 * `IPCA + 6%` ou `110% do CDI`; o que sai daqui é sempre o texto canônico.
 */
export const benchmarkSchema = z
  .string()
  .refine((value) => parseBenchmark(value) !== null, 'informe um benchmark como CDI, IPCA+6 ou 110%CDI')
  .transform((value) => normalizeBenchmark(value) ?? value);

export const strategyTargetResourceSchema = z.object({
  category_id: uuid,
  target_pct: percentString,
});

export const portfolioResourceSchema = z.object({
  id: uuid,
  name: z.string(),
  benchmark: z.string().nullable(),
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
  benchmark: benchmarkSchema.nullable().optional(),
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
