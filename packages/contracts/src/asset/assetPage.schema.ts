import {
  CORPORATE_EVENT_KINDS,
  PAYOUT_KINDS,
  TRANSACTION_KINDS,
} from '@patrimonio/domain';
import { z } from 'zod';

import {
  positionUnitSchema,
  computedPriceKindSchema,
} from '../position/position.schema.js';
import { dateOnly, decimalString, uuid } from '../support/primitives.schema.js';
import {
  assetOriginSchema,
  b3TypeSchema,
  indexerSchema,
  liquidityKindSchema,
  priceSourceSchema,
  taxRegimeSchema,
} from './asset.schema.js';

/**
 * T-03 · O que a página do ativo recebe.
 *
 * A tela responde uma pergunta de decisão — vale manter, aumentar ou sair —, e o
 * formato segue disso. Tudo que ela mostra chega em **um** recurso: posição,
 * série de preço, proventos por mês, lançamentos, cadastro e eventos. Pedir
 * cinco rotas e costurar o resultado no navegador daria cinco momentos em que
 * metade da tela está pronta, e o orçamento de consultas (T-11) é por rota.
 *
 * As duas regras de sempre: valor monetário viaja como string, e `null` é
 * ausência e nunca zero. Papel sem provento em doze meses devolve
 * `dividend_yield_12m` nulo; papel que nunca foi vendido devolve
 * `realized_result` nulo — e não `0,00`, que leria como "vendi e não ganhei
 * nada".
 */

/** A janela do gráfico de preço, como a prancha 06 a desenha. */
export const assetPeriodSchema = z.enum(['6m', '1a', '3a', 'tudo']);

export type AssetPeriod = z.infer<typeof assetPeriodSchema>;

/**
 * O cadastro, que é o bloco "Dados do ativo". Categoria vem com a cor em token
 * para a pastilha do cabeçalho ser a mesma cor que a linha em Posições.
 */
export const assetPageIdentitySchema = z.object({
  asset_id: uuid,
  ticker: z.string(),
  name: z.string(),
  origin: assetOriginSchema,
  b3_type: b3TypeSchema.nullable(),
  sector: z.string().nullable(),
  price_source: priceSourceSchema,
  category_id: uuid.nullable(),
  category_name: z.string().nullable(),
  color_token: z.string().nullable(),
  /** A regra automática classificou, ou alguém escolheu à mão (L-03). */
  category_automatic: z.boolean(),
  issuer_name: z.string().nullable(),
  archived_at: z.string().nullable(),

  indexer: indexerSchema.nullable(),
  rate: decimalString.nullable(),
  issued_at: dateOnly.nullable(),
  maturity_date: dateOnly.nullable(),
  liquidity: liquidityKindSchema.nullable(),
  liquidity_days: z.number().int().nullable(),
  tax_regime: taxRegimeSchema.nullable(),
});

export type AssetPageIdentity = z.infer<typeof assetPageIdentitySchema>;

/**
 * A posição no recorte. `unit` é `curve` no título sem cotação, e aí quantidade
 * e preço médio são nulos de propósito: o papel vale o que a marcação diz na
 * data, e `accrued_interest` é o que a curva acumulou.
 */
export const assetPagePositionSchema = z.object({
  unit: positionUnitSchema,
  quantity: decimalString.nullable(),
  avg_price: decimalString.nullable(),
  cost_basis: decimalString,
  value: decimalString,
  open_result: decimalString,
  open_result_ratio: decimalString.nullable(),
  /** Participação no patrimônio do recorte, como razão de 0 a 1. */
  weight: decimalString,
  /** O que a marcação na curva acumulou. Zero fora da renda fixa. */
  accrued_interest: decimalString,
  /** A soma dos resultados de venda. Nulo quando nunca houve venda. */
  realized_result: decimalString.nullable(),
  payouts_12m: decimalString,
  /** Proventos de doze meses sobre o **custo**: o yield sobre custo da prancha. */
  yield_on_cost_12m: decimalString.nullable(),
});

export type AssetPagePosition = z.infer<typeof assetPagePositionSchema>;

/** O preço do dia, com a procedência que autoriza a confiar nele. */
export const assetPagePriceSchema = z.object({
  /** Valor unitário na data do fechamento. Nulo na curva. */
  value: decimalString.nullable(),
  day_change_ratio: decimalString.nullable(),
  price_health: computedPriceKindSchema.nullable(),
  price_date: dateOnly.nullable(),
});

/**
 * Um ponto da série do gráfico.
 *
 * `close` é o preço **como foi negociado** na data, que é o que todo cálculo de
 * patrimônio usa; `adjusted_close` é o mesmo preço na escala de hoje, e existe
 * porque sem ele um desdobramento 1:2 aparece no gráfico como uma queda de 50%
 * que não aconteceu (M-15).
 */
export const assetPagePointSchema = z.object({
  price_date: dateOnly,
  close: decimalString,
  adjusted_close: decimalString,
});

/**
 * Uma marca de compra ou venda no gráfico. Um ponto por data e por lado: duas
 * compras no mesmo dia são uma marca, com a quantidade somada e o preço médio
 * ponderado delas.
 */
export const assetPageTradeMarkSchema = z.object({
  trade_date: dateOnly,
  side: z.enum(['buy', 'sell']),
  quantity: decimalString,
  unit_price: decimalString,
});

export const assetPageSeriesSchema = z.object({
  period: assetPeriodSchema,
  from: dateOnly.nullable(),
  to: dateOnly.nullable(),
  points: z.array(assetPagePointSchema),
  marks: z.array(assetPageTradeMarkSchema),
  /** Verdadeiro quando um evento confirmado afeta a janela: a legenda diz. */
  adjusted: z.boolean(),
  /**
   * A variação de preço na janela, e a mesma variação somando os proventos
   * recebidos no período sobre o preço inicial. Nulas com menos de dois pontos:
   * janela maior que o histórico devolve traço, nunca um número inventado.
   */
  return_ratio: decimalString.nullable(),
  return_with_payouts_ratio: decimalString.nullable(),
});

/** Uma barra da grade de proventos: um mês, dividido por tipo de provento. */
export const assetPagePayoutMonthSchema = z.object({
  /** `2026-09` — o mês, sem dia, porque a barra é o mês inteiro. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  dividend: decimalString,
  jcp: decimalString,
  income: decimalString,
  interest: decimalString,
  amortization: decimalString,
  total: decimalString,
});

export const assetPagePayoutsSchema = z.object({
  months: z.array(assetPagePayoutMonthSchema),
  total_12m: decimalString,
  /**
   * O provento anunciado e ainda não recebido, que é a linha "a receber" da
   * prancha. Vazio quando não há nenhum — e aí o bloco não mostra a linha.
   */
  upcoming: z.array(
    z.object({
      transaction_id: uuid,
      settlement_date: dateOnly,
      payout_kind: z.enum(PAYOUT_KINDS),
      net_amount: decimalString,
    }),
  ),
});

/**
 * Um lançamento do ativo, na lista da direita. `effect` não vem: a coluna
 * "Efeito" é de T-04, e a lista daqui é curta de propósito — ela existe para
 * reconhecer o lançamento, não para auditá-lo.
 */
export const assetPageTransactionSchema = z.object({
  id: uuid,
  kind: z.enum(TRANSACTION_KINDS),
  payout_kind: z.enum(PAYOUT_KINDS).nullable(),
  trade_date: dateOnly,
  settlement_date: dateOnly,
  quantity: decimalString,
  unit_price: decimalString,
  net_amount: decimalString,
  /** Nulo enquanto o provento está "a receber". */
  confirmed_at: z.string().nullable(),
  portfolio_id: uuid,
  portfolio_name: z.string(),
  institution_name: z.string().nullable(),
});

export const assetPageTransactionsSchema = z.object({
  /** As mais recentes. A lista inteira é Movimentações (T-04). */
  recent: z.array(assetPageTransactionSchema),
  /** Quantos lançamentos existem no recorte, com o filtro de tipo aplicado. */
  total: z.number().int().nonnegative(),
  /** As contagens por tipo, que são as opções do filtro e o que cada uma traz. */
  facets: z.array(
    z.object({
      kind: z.enum(TRANSACTION_KINDS),
      count: z.number().int().nonnegative(),
    }),
  ),
});

/**
 * Um evento corporativo do ativo. Não confirmado aparece como o que ainda não
 * mexeu na quantidade: a confirmação é de M-14, e a quantidade só muda depois.
 */
export const assetPageCorporateEventSchema = z.object({
  id: uuid,
  kind: z.enum(CORPORATE_EVENT_KINDS),
  record_date: dateOnly,
  ratio_from: decimalString,
  ratio_to: decimalString,
  confirmed_at: z.string().nullable(),
});

/** Onde o papel está: uma linha por carteira com posição aberta. */
export const assetPagePortfolioSchema = z.object({
  portfolio_id: uuid,
  portfolio_name: z.string(),
  quantity: decimalString.nullable(),
  value: decimalString,
});

/** Onde está custodiado: uma linha por instituição que aparece no livro. */
export const assetPageCustodianSchema = z.object({
  institution_id: uuid,
  institution_name: z.string(),
});

export const assetPageResourceSchema = z.object({
  /** Nulo é o escopo de todas as carteiras. */
  portfolio_id: uuid.nullable(),
  portfolio_name: z.string().nullable(),
  /** O dia de projeção mostrado — o último fechado em ou antes de hoje. */
  as_of: dateOnly.nullable(),
  computed_at: z.string().nullable(),

  asset: assetPageIdentitySchema,
  price: assetPagePriceSchema,
  /**
   * Nulo quando o ativo não tem posição aberta no recorte: o histórico fica, e
   * a tela diz que a posição está zerada em vez de mostrar seis zeros (O-09).
   */
  position: assetPagePositionSchema.nullable(),
  series: assetPageSeriesSchema,
  payouts: assetPagePayoutsSchema,
  transactions: assetPageTransactionsSchema,
  corporate_events: z.array(assetPageCorporateEventSchema),
  portfolios: z.array(assetPagePortfolioSchema),
  custodians: z.array(assetPageCustodianSchema),
});

export type AssetPageResource = z.infer<typeof assetPageResourceSchema>;

/**
 * O recorte da página, que é também o que cabe na URL.
 *
 * Nenhum filtro é aplicado no navegador, pela mesma razão de T-02: quem filtra
 * é quem soma. O filtro de tipo de lançamento recorta a lista **e** a contagem,
 * e a janela do gráfico recorta a série **e** a variação do período.
 */
/**
 * Como o ativo é referenciado no endereço: pelo código, ou pelo identificador.
 *
 * `/longo-prazo/ativo/itub4` é um endereço que alguém cola em outra aba, e é a
 * mesma decisão que faz o escopo ser o apelido da carteira e não o UUID dela. O
 * identificador continua valendo porque título de banco não tem código que
 * alguém reconheça — `CDB-BANCOC-20280614` é chave de banco de dados.
 */
export const assetRefSchema = z.union([
  uuid,
  z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,20}$/),
]);

export const getAssetPageSchema = z.object({
  params: z.object({ asset_id: assetRefSchema }),
  query: z.object({
    /** Ausente significa todas as carteiras ativas. */
    portfolio_id: uuid.optional(),
    period: assetPeriodSchema.default('1a'),
    /** Ausente é todos os tipos. */
    kind: z.enum(TRANSACTION_KINDS).optional(),
  }),
});

export type GetAssetPageQuery = z.infer<typeof getAssetPageSchema>['query'];
