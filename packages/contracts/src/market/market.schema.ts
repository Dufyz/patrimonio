import { z } from 'zod';

import { dateOnly, decimalString, uuid } from '../support/primitives.schema.js';

/**
 * O contrato da tela de dados de mercado. Ela existe para responder uma
 * pergunta só: **o número que está na tela é de hoje?**
 *
 * Por isso cada fonte carrega situação, horário da última coleta e cobertura, e
 * por isso a falha aparece com a mensagem do erro em vez de um código — "brapi
 * respondeu 503" diz o que fazer; "E_PROVIDER_5" não diz nada.
 */
export const marketRunKindSchema = z.enum([
  'quotes',
  'indices',
  'treasury',
  'backfill',
  'cotahist',
  'contract_check',
]);

export const marketSourceRunSchema = z.object({
  id: uuid,
  source: z.string(),
  kind: marketRunKindSchema,
  reference_date: dateOnly.nullable(),
  started_at: z.string(),
  finished_at: z.string(),
  ok: z.boolean(),
  source_kind: z.enum(['primary', 'fallback', 'manual']).nullable(),
  requests: z.number().int(),
  items: z.number().int(),
  missing: z.number().int(),
  error: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
});

export const sourceStatusSchema = z.object({
  source: z.string(),
  kind: marketRunKindSchema,
  /** `ok` enquanto a última coleta deu certo; `stale` quando ela é antiga. */
  status: z.enum(['ok', 'stale', 'failing', 'never_run']),
  last_run: marketSourceRunSchema.nullable(),
  /** Quantas linhas a última coleta gravou, e quantos papéis ficaram sem. */
  coverage: z.object({
    items: z.number().int(),
    missing: z.number().int(),
  }),
  budget: z
    .object({
      used: z.number().int(),
      ceiling: z.number().int(),
      remaining: z.number().int(),
      warning: z.boolean(),
      exceeded: z.boolean(),
    })
    .nullable(),
});

export const missingPriceSchema = z.object({
  asset_id: uuid,
  ticker: z.string(),
  /** A última data com preço, quando houve alguma. */
  last_price_date: dateOnly.nullable(),
});

export const marketHealthSchema = z.object({
  reference_date: dateOnly,
  sources: z.array(sourceStatusSchema),
  /** As falhas recentes, com a mensagem do erro. */
  recent_failures: z.array(marketSourceRunSchema),
  /** Papéis com posição aberta e sem preço do dia, prontos para preço manual. */
  missing_prices: z.array(missingPriceSchema),
});

export const getMarketHealthSchema = z.object({
  query: z.object({
    on_date: dateOnly.optional(),
  }),
});

/**
 * "Atualizar agora". Ela enfileira e devolve na hora: coletar leva segundos e a
 * tela não pode ficar esperando a fonte responder.
 */
export const refreshMarketSchema = z.object({
  body: z.object({
    on_date: dateOnly.optional(),
    /** Com ativo, é um backfill daquele papel em vez da coleta do dia. */
    asset_id: uuid.optional(),
  }),
});

export const priceSeriesPointSchema = z.object({
  price_date: dateOnly,
  /** O preço como foi negociado na data. É o que todo cálculo usa. */
  close: decimalString,
  /** O mesmo preço na escala de hoje, para o gráfico. */
  adjusted_close: decimalString,
  factor: decimalString,
});

export const assetPriceSeriesSchema = z.object({
  asset_id: uuid,
  ticker: z.string(),
  points: z.array(priceSeriesPointSchema),
  events: z.array(z.object({ record_date: dateOnly, factor: decimalString })),
  /** Verdadeiro quando algum evento afeta o intervalo: a legenda diz isso. */
  adjusted: z.boolean(),
});

export const getAssetPriceSeriesSchema = z.object({
  params: z.object({ asset_id: uuid }),
  query: z.object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
  }),
});

export type MarketHealth = z.infer<typeof marketHealthSchema>;
export type SourceStatusResource = z.infer<typeof sourceStatusSchema>;
export type AssetPriceSeriesResource = z.infer<typeof assetPriceSeriesSchema>;
export type RefreshMarketBody = z.infer<typeof refreshMarketSchema>['body'];
