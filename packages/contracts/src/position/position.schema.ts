import {
  COMPUTED_PRICE_KINDS,
  POSITION_GROUP_BY,
  POSITION_UNITS,
} from '@patrimonio/domain';
import { z } from 'zod';

import { b3TypeSchema, indexerSchema, assetOriginSchema } from '../asset/asset.schema.js';
import { dateOnly, decimalString, uuid } from '../support/primitives.schema.js';

/**
 * T-02 · O que a tela de Posições recebe.
 *
 * Três decisões mandam no formato, e as três são a mesma decisão vista de
 * ângulos diferentes: **o web não soma dinheiro**. O subtotal de cada grupo, o
 * total geral, o peso de cada linha e a contagem de cada pastilha chegam
 * prontos daqui. É o que mantém o subtotal correto quando "mostrar mais"
 * esconde nove das catorze linhas, e o que impede duas telas de discordarem
 * sobre o mesmo número.
 *
 * Valor monetário viaja como string, sempre; `null` é ausência e nunca zero.
 */
export const computedPriceKindSchema = z.enum(COMPUTED_PRICE_KINDS);

export const positionGroupBySchema = z.enum(POSITION_GROUP_BY);

export type PositionGroupBy = z.infer<typeof positionGroupBySchema>;

/**
 * Como a linha mede o que tem: em cota, ou na curva.
 *
 * CDB, LCI e debênture não têm cotação nem quantidade com significado para quem
 * lê — eles valem o que a curva diz na data. A tela mostra traço em quantidade e
 * em preço nessas linhas, e `curve` é o que a autoriza a fazer isso sem
 * adivinhar pelo tipo do papel.
 */
export const positionUnitSchema = z.enum(POSITION_UNITS);

export const positionResourceSchema = z.object({
  portfolio_id: uuid,
  portfolio_name: z.string(),
  asset_id: uuid,
  ticker: z.string(),
  name: z.string(),
  origin: assetOriginSchema,
  b3_type: b3TypeSchema.nullable(),

  /** Onde está custodiado: a instituição do lançamento mais recente da linha. */
  institution_id: uuid.nullable(),
  institution_name: z.string().nullable(),

  category_id: uuid.nullable(),
  category_name: z.string().nullable(),
  /** `class.acoes`, nunca um hexadecimal: a cor sai do tema, não da resposta. */
  color_token: z.string().nullable(),

  unit: positionUnitSchema,
  quantity: decimalString.nullable(),
  avg_price: decimalString.nullable(),
  /** Valor unitário na data: `market_value / quantity`. Nulo na curva. */
  price: decimalString.nullable(),
  price_health: computedPriceKindSchema,
  /** A data do preço usado, que é o que a ressalva da linha mostra. */
  price_date: dateOnly.nullable(),

  value: decimalString,
  cost_basis: decimalString,
  open_result: decimalString,
  /** Nulo quando o custo é zero: dividir por zero é ausência, não infinito. */
  open_result_ratio: decimalString.nullable(),
  /** Participação na soma do recorte, como razão de 0 a 1. */
  weight: decimalString,

  /** Variação do valor unitário contra o fechamento anterior. */
  day_change_ratio: decimalString.nullable(),
  /** Variação do valor unitário em doze meses. Nula com histórico mais curto. */
  return_12m_ratio: decimalString.nullable(),
  /** Proventos confirmados em doze meses sobre o valor de hoje. */
  dividend_yield_12m: decimalString.nullable(),

  indexer: indexerSchema.nullable(),
  rate: decimalString.nullable(),
  maturity_date: dateOnly.nullable(),
});

export type PositionResource = z.infer<typeof positionResourceSchema>;

/**
 * O subtotal de um grupo. Valor, custo, resultado e peso somam; retorno não.
 *
 * Somar retorno de linhas é o erro clássico desta tela: a soma ponderada de
 * variações só vale quando nada entrou nem saiu no período, e aporte no meio do
 * mês é a regra, não a exceção. O retorno correto de um conjunto sai da série de
 * cota (C-07), que existe por carteira e não por grupo — então o grupo não
 * responde por ele, e a tela mostra traço em vez de um número inventado.
 */
export const positionSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  value: decimalString,
  cost_basis: decimalString,
  open_result: decimalString,
  open_result_ratio: decimalString.nullable(),
  weight: decimalString,
});

export type PositionSummary = z.infer<typeof positionSummarySchema>;

export const positionGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  color_token: z.string().nullable(),
  summary: positionSummarySchema,
  positions: z.array(positionResourceSchema),
});

export type PositionGroup = z.infer<typeof positionGroupSchema>;

/** Uma pastilha de categoria, com a contagem que ela filtra. */
export const positionFacetSchema = z.object({
  id: z.string(),
  label: z.string(),
  color_token: z.string().nullable(),
  count: z.number().int().nonnegative(),
});

export const positionHealthSchema = z.object({
  fresh: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
  manual: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
});

export const positionsResourceSchema = z.object({
  /** O dia de projeção que a tela está mostrando — o último fechado. */
  as_of: dateOnly.nullable(),
  /** Quando aquele fechamento foi calculado: "a preço de 06/10 18:02". */
  computed_at: z.string().nullable(),
  group_by: positionGroupBySchema,
  groups: z.array(positionGroupSchema),
  total: positionSummarySchema,
  /**
   * O retorno da carteira: sai da série de cota, que é a única medida que aporte
   * e resgate não contaminam. Nulo quando a carteira não tem cota para comparar.
   */
  day_change_ratio: decimalString.nullable(),
  return_12m_ratio: decimalString.nullable(),
  /** Proventos confirmados nos últimos doze meses, no recorte. */
  payouts_12m: decimalString,
  /** As pastilhas de categoria, contadas antes do filtro de categoria. */
  facets: z.array(positionFacetSchema),
  price_health: positionHealthSchema,
});

export type PositionsResource = z.infer<typeof positionsResourceSchema>;
