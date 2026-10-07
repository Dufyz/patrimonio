import type { DateOnly } from '../support/date_only.js';

/**
 * As tabelas de projeção. Ninguém escreve nelas a não ser o motor de recálculo:
 * nenhuma rota de escrita as toca, e é por isso que elas podem ser apagadas e
 * reconstruídas do livro sem perda.
 *
 * Elas carregam `computed_at` e não `updated_at`: são reescritas inteiras em vez
 * de editadas.
 */
export const COMPUTED_PRICE_KINDS = ['fresh', 'stale', 'manual', 'missing'] as const;

/**
 * O estado do preço usado na linha, gravado junto com ela. É calculado no
 * fechamento, nunca inferido na tela — a tela não tem como saber se o preço de
 * ontem foi usado porque hoje não houve negócio ou porque a fonte caiu.
 */
export type ComputedPriceKind = (typeof COMPUTED_PRICE_KINDS)[number];

export type PositionDaily = {
  readonly portfolio_id: string;
  readonly asset_id: string;
  readonly position_date: DateOnly;
  readonly quantity: string;
  readonly avg_price: string;
  readonly cost_basis: string;
  /** Cotação, ou valor na curva em renda fixa, ou o custo quando não há preço. */
  readonly market_value: string;
  readonly price_source_kind: ComputedPriceKind;
  readonly accrued_interest: string;
  readonly computed_at: string;
};

export type PortfolioDaily = {
  readonly portfolio_id: string;
  readonly position_date: DateOnly;
  readonly total_value: string;
  readonly net_flow: string;
  readonly income: string;
  readonly payouts: string;
  readonly quota_value: string;
  readonly quota_count: string;
  readonly cumulative_contributions: string;
  readonly computed_at: string;
};

export type RealizedResult = {
  readonly transaction_id: string;
  readonly portfolio_id: string;
  readonly asset_id: string;
  readonly trade_date: DateOnly;
  readonly proceeds: string;
  readonly cost_consumed: string;
  readonly result: string;
  readonly exempt: boolean;
  readonly loss_offset: string;
  readonly computed_at: string;
};

/**
 * As três classes que a apuração distingue. Não é tipo de instrumento: é regime
 * de tributação. BDR não tem enum próprio porque compartilha o regime do ETF —
 * 15% e sem isenção por valor de venda.
 */
export const ASSET_CLASSES = ['stock', 'fii', 'etf'] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

export type TaxMonth = {
  readonly year: number;
  readonly month: number;
  readonly asset_class: AssetClass;
  readonly sales_total: string;
  readonly gross_result: string;
  readonly exempt: boolean;
  readonly loss_carried_forward: string;
  readonly computed_at: string;
};

export const ALERT_STATUSES = ['open', 'snoozed', 'ignored'] as const;

export type AlertStatus = (typeof ALERT_STATUSES)[number];

/**
 * A única projeção com estado que o usuário mexe: adiar e ignorar. Esse estado
 * precisa sobreviver ao recálculo, então o motor reconcilia por
 * `(rule_kind, subject_id)` em vez de apagar e regravar.
 */
export type AlertInstance = {
  readonly rule_kind: string;
  readonly subject_id: string;
  readonly portfolio_id: string | null;
  readonly status: AlertStatus;
  readonly snooze_until: DateOnly | null;
  readonly payload: Record<string, unknown>;
  readonly first_seen_at: string;
  readonly updated_at: string;
};

/**
 * De onde o preço gravado veio. `primary` é a fonte principal da cadeia,
 * `fallback` é a que assumiu quando ela falhou, e `manual` é o preço digitado.
 * É o que a tela de dados de mercado mostra como "quem respondeu por último".
 */
export const PRICE_SOURCE_KINDS = ['primary', 'fallback', 'manual'] as const;

export type PriceSourceKind = (typeof PRICE_SOURCE_KINDS)[number];

export type AssetPrice = {
  readonly asset_id: string;
  readonly price_date: DateOnly;
  readonly close: string;
  readonly source: string;
  readonly source_kind: PriceSourceKind;
  readonly fetched_at: string;
};

/**
 * Índice guardado como **fator diário**, não como percentual acumulado: o retorno
 * de qualquer janela é um produto de fatores, sem reinterpretar a série a cada
 * consulta.
 */
export type IndexQuote = {
  readonly index_code: string;
  readonly quote_date: DateOnly;
  readonly daily_factor: string;
  readonly raw_value: string | null;
  readonly source: string;
  readonly fetched_at: string;
};

/** Os códigos de índice em uso. */
export const INDEX_CODES = ['CDI', 'SELIC', 'IPCA', 'IBOV', 'IFIX'] as const;

export type IndexCode = (typeof INDEX_CODES)[number];

export const isIndexCode = (value: unknown): value is IndexCode =>
  typeof value === 'string' && (INDEX_CODES as readonly string[]).includes(value);

/**
 * O índice que remunera cada indexador. `prefixed` não tem índice: a taxa
 * contratada é a remuneração inteira.
 */
export const indexForIndexer = (
  indexer: 'cdi_pct' | 'ipca_plus' | 'prefixed' | 'selic_plus',
): IndexCode | null => {
  switch (indexer) {
    case 'cdi_pct':
      return 'CDI';
    case 'ipca_plus':
      return 'IPCA';
    case 'selic_plus':
      return 'SELIC';
    case 'prefixed':
      return null;
  }
};

/**
 * A classe de apuração de um papel. Renda fixa, Tesouro e caixa devolvem nulo:
 * eles não entram na apuração de renda variável, e o IR deles é retido na fonte.
 */
export const assetClassFor = (
  b3Type: 'stock' | 'fii' | 'etf' | 'bdr' | 'treasury' | 'cash' | null,
): AssetClass | null => {
  switch (b3Type) {
    case 'stock':
      return 'stock';
    case 'fii':
      return 'fii';
    case 'etf':
      return 'etf';
    // BDR paga 15% e não tem isenção por valor de venda: é o regime do ETF.
    case 'bdr':
      return 'etf';
    default:
      return null;
  }
};
