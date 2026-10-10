import { z } from 'zod';

import { overviewCompositionSchema } from '../overview/overview.schema.js';
import { recalcStatusSchema } from '../portfolio/portfolio.schema.js';
import {
  dateOnly,
  decimalString,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';

/**
 * T-06 · A estratégia da carteira contra o que ela tem hoje.
 *
 * A tela responde uma pergunta — o dinheiro está dividido como eu disse que
 * queria? — e por isso a resposta traz, de uma vez, o alvo, o atual, o desvio e
 * quanto mover. Todo número vem pronto: a tela não soma grupo, não calcula
 * desvio e não decide o que está fora da faixa. Dois cálculos do mesmo desvio
 * divergem, e a tela que mostra +1,3 pp numa linha e 1,2 numa barra é a que
 * ninguém mais abre.
 *
 * A estratégia é **de uma carteira**, e por isso o parâmetro é obrigatório.
 */

export const allocationRulesSchema = z.object({
  /** Acima disso em pontos percentuais, a linha fica em destaque. */
  tolerance_pp: decimalString,
  /** O dia em que a estratégia foi salva pela última vez. Nulo sem estratégia. */
  reviewed_on: dateOnly.nullable(),
  benchmark: z.object({ id: uuid, name: z.string() }).nullable(),
});

export const allocationPortfolioSchema = z.object({
  id: uuid,
  name: z.string(),
  recalc_status: recalcStatusSchema,
});

/**
 * A linha de uma categoria que existe no cadastro, tenha ou não posição. É o que
 * permite declarar alvo para uma categoria vazia: sem a lista do cadastro, a
 * primeira estratégia só poderia usar o que já está em carteira.
 */
export const allocationShareSchema = z.object({
  category_id: z.string(),
  name: z.string(),
  color_token: z.string(),
  amount: decimalString,
  /** O desvio da categoria depois do aporte, em pontos percentuais com sinal. */
  deviation_after_pp: decimalString,
});

export const allocationContributionSchema = z.object({
  amount: decimalString,
  allocated: decimalString,
  /** O que o alvo não pede. Fica em conta, não em ativo nenhum. */
  unallocated: decimalString,
  shares: z.array(allocationShareSchema),
  max_deviation_before_pp: decimalString.nullable(),
  max_deviation_after_pp: decimalString.nullable(),
});

export const allocationSchema = z.object({
  /** O último fechamento da carteira em ou antes da data pedida. Nulo antes do primeiro. */
  reference_date: dateOnly.nullable(),
  portfolio: allocationPortfolioSchema,
  rules: allocationRulesSchema,
  /**
   * Verdadeiro quando a carteira tem alvo declarado. É a diferença entre "0%" e
   * "sem alvo": com estratégia, a categoria que ficou de fora tem alvo zero e o
   * desvio dela é a posição inteira; sem estratégia, a coluna de desvio fica
   * vazia em vez de mostrar um desvio contra um alvo que ninguém escolheu.
   */
  strategy_defined: z.boolean(),
  composition: overviewCompositionSchema,
  /** Presente só quando a rota recebeu um valor de aporte. */
  contribution: allocationContributionSchema.nullable(),
});

export const getAllocationSchema = z.object({
  query: z.object({
    portfolio_id: uuid,
    on_date: dateOnly.optional(),
    /** O valor do aporte a distribuir. Ausente é só a leitura da estratégia. */
    contribution: positiveDecimal.optional(),
  }),
});

export type AllocationResource = z.infer<typeof allocationSchema>;
export type AllocationRulesResource = z.infer<typeof allocationRulesSchema>;
export type AllocationContributionResource = z.infer<typeof allocationContributionSchema>;
export type AllocationShareResource = z.infer<typeof allocationShareSchema>;
