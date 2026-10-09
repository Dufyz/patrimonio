import { z } from 'zod';

import { dateOnly, decimalString, uuid } from '../support/primitives.schema.js';

/**
 * O contrato da tela de abertura. Ela responde duas perguntas, nesta ordem:
 * **quanto eu tenho hoje** e **o que precisa de mim** — e a forma da resposta
 * é essa ordem.
 *
 * Três coisas que o contrato torna impossíveis de confundir:
 *
 * - **Ausência não é zero.** `value`, `day` e `month` são nulos quando não há
 *   fechamento para comparar, e a tela mostra traço. Zero significa que o
 *   número é zero.
 * - **O retorno declara o método.** Com uma carteira ele sai da cota gravada;
 *   no consolidado, de uma cota construída sobre a janela. São respostas
 *   diferentes para a mesma pergunta, e a tela precisa poder dizer qual é.
 * - **O estado do preço viaja junto da posição.** Um valor marcado com preço
 *   de três dias atrás não pode chegar à tela com a mesma cara de um valor de
 *   hoje.
 */
export const overviewChangeSchema = z.object({
  amount: decimalString,
  /** Nulo quando a base é zero: `+∞%` não é resposta. */
  ratio: decimalString.nullable(),
});

export const overviewScopeSchema = z.object({
  /** Nulo é o consolidado: "todas as carteiras" é a ausência de escopo. */
  portfolio_id: uuid.nullable(),
  name: z.string(),
  purpose: z.string().nullable(),
  tolerance_pp: decimalString,
  recalc_status: z.enum(['idle', 'queued', 'running', 'failed']),
  /** O primeiro fechamento do escopo: é o que o período "Início" significa. */
  inception: dateOnly.nullable(),
});

export const overviewTotalsSchema = z.object({
  value: decimalString.nullable(),
  day: overviewChangeSchema.nullable(),
  month: overviewChangeSchema.nullable(),
  /** Quanto o escopo é do patrimônio inteiro. Nulo no consolidado. */
  weight_pct: decimalString.nullable(),
});

export const overviewPeriodSchema = z.object({
  from: dateOnly,
  to: dateOnly,
  return_pct: decimalString.nullable(),
  return_method: z.enum(['portfolio_quota', 'window_quota', 'unavailable']),
  contributions: decimalString,
  income: decimalString,
  payouts: decimalString,
});

/**
 * Um ponto da evolução. `result` é a diferença entre o patrimônio e o aporte
 * acumulado, e é negativo quando a carteira está abaixo do que foi aportado —
 * cortar isso em zero esconderia justamente o caso em que olhar o gráfico
 * importa.
 */
export const overviewPointSchema = z.object({
  date: dateOnly,
  contributions: decimalString,
  total: decimalString,
  result: decimalString,
});

const compositionBase = {
  id: z.string(),
  name: z.string(),
  level: z.enum(['group', 'category']),
  value: decimalString,
  current_pct: decimalString,
  /** Nulo quando não há alvo: a coluna de desvio fica vazia, não zerada. */
  target_pct: decimalString.nullable(),
  deviation_pp: decimalString.nullable(),
  over_tolerance: z.boolean(),
  amount_to_move: decimalString.nullable(),
};

/**
 * Dois níveis, e só dois: grupo e categoria. É a mesma restrição que o banco
 * impõe, e o schema a repete porque uma árvore de três níveis quebraria todo
 * subtotal desta tela.
 */
export const compositionChildSchema = z.object({
  ...compositionBase,
  children: z.array(z.never()).default([]),
});

export const compositionNodeSchema = z.object({
  ...compositionBase,
  children: z.array(compositionChildSchema),
});

export const overviewCompositionSchema = z.object({
  total: decimalString,
  nodes: z.array(compositionNodeSchema),
  target_sum: z.object({
    total_pct: decimalString,
    missing_pp: decimalString,
    closes: z.boolean(),
  }),
  /** Verdadeiro quando o alvo declarado não fecha 100% nem está vazio. */
  target_rejected: z.boolean(),
});

export const overviewPortfolioShareSchema = z.object({
  portfolio_id: uuid,
  name: z.string(),
  value: decimalString,
  weight_pct: decimalString,
});

export const overviewTopPositionSchema = z.object({
  asset_id: uuid,
  ticker: z.string(),
  name: z.string(),
  /** Token do design system, nunca hexadecimal. */
  color_token: z.string().nullable(),
  value: decimalString,
  weight_pct: decimalString,
  price_source_kind: z.enum(['fresh', 'stale', 'manual', 'missing']),
});

export const overviewAttentionItemSchema = z.object({
  rule_kind: z.string(),
  subject_id: z.string(),
  portfolio_id: uuid.nullable(),
  /** Os valores que o texto do alerta mostra, como a regra os gravou. */
  payload: z.record(z.string(), z.unknown()),
  first_seen_at: z.string(),
});

export const overviewAttentionSchema = z.object({
  total: z.number().int(),
  total_all_portfolios: z.number().int(),
  /** Grupo sem item não vem: nenhum bloco aparece vazio. */
  groups: z.array(
    z.object({
      group: z.enum(['corrigir', 'decidir', 'acompanhar']),
      count: z.number().int(),
      items: z.array(overviewAttentionItemSchema),
    }),
  ),
});

export const overviewSchema = z.object({
  /** O último fechamento em ou antes da data pedida. Nulo antes do primeiro. */
  reference_date: dateOnly.nullable(),
  scope: overviewScopeSchema,
  totals: overviewTotalsSchema,
  period: overviewPeriodSchema,
  series: z.array(overviewPointSchema),
  composition: overviewCompositionSchema,
  by_portfolio: z.array(overviewPortfolioShareSchema),
  top_positions: z.object({
    total_count: z.number().int(),
    rows: z.array(overviewTopPositionSchema),
  }),
  attention: overviewAttentionSchema,
});

export const getOverviewSchema = z.object({
  query: z.object({
    /** Ausente é o consolidado. A carteira é filtro, não rota. */
    portfolio_id: uuid.optional(),
    on_date: dateOnly.optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  }),
});

export type OverviewResource = z.infer<typeof overviewSchema>;
export type OverviewPointResource = z.infer<typeof overviewPointSchema>;
export type OverviewTopPositionResource = z.infer<typeof overviewTopPositionSchema>;
export type OverviewCompositionResource = z.infer<typeof overviewCompositionSchema>;
export type OverviewAttentionResource = z.infer<typeof overviewAttentionSchema>;
export type OverviewAttentionItemResource = z.infer<typeof overviewAttentionItemSchema>;
export type OverviewPortfolioShareResource = z.infer<typeof overviewPortfolioShareSchema>;
