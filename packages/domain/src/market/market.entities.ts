import type { DateOnly } from '../support/date_only.js';
import type { PriceSourceKind } from '../projection/projection.entities.js';

/**
 * O registro de uma execução de coleta. É o que a tela de dados de mercado lê
 * para dizer se o número que está na tela é de hoje — e é a única coisa que E4
 * acrescenta ao modelo, porque cinco perguntas não são deriváveis de
 * `asset_price`: qual fonte respondeu por último, quanto da cota do mês foi
 * consumido, qual foi a última falha e com que mensagem, quando a bateria de
 * contrato rodou contra a API real, e o que ela encontrou.
 */
export const MARKET_RUN_KINDS = [
  'quotes',
  'indices',
  'treasury',
  'backfill',
  'cotahist',
  'contract_check',
] as const;

export type MarketRunKind = (typeof MARKET_RUN_KINDS)[number];

export const isMarketRunKind = (value: unknown): value is MarketRunKind =>
  typeof value === 'string' && (MARKET_RUN_KINDS as readonly string[]).includes(value);

export type MarketSourceRun = {
  readonly id: string;
  readonly source: string;
  readonly kind: MarketRunKind;
  /** A data coletada. Nula na bateria de contrato, que não coleta nada. */
  readonly reference_date: DateOnly | null;
  readonly started_at: string;
  readonly finished_at: string;
  readonly ok: boolean;
  readonly source_kind: PriceSourceKind | null;
  readonly requests: number;
  readonly items: number;
  readonly missing: number;
  readonly error: string | null;
  readonly detail: Record<string, unknown> | null;
  readonly created_at: string;
};

/** O que o caso de uso grava: a linha antes de existir no banco. */
export type MarketSourceRunDraft = {
  readonly source: string;
  readonly kind: MarketRunKind;
  readonly reference_date?: DateOnly | null | undefined;
  readonly started_at: string;
  readonly finished_at: string;
  readonly ok: boolean;
  readonly source_kind?: PriceSourceKind | null | undefined;
  readonly requests?: number | undefined;
  readonly items?: number | undefined;
  readonly missing?: number | undefined;
  readonly error?: string | null | undefined;
  readonly detail?: Record<string, unknown> | null | undefined;
};

/**
 * Um papel que precisa de preço numa data. Sai de quem tem posição aberta, não
 * do cadastro: ativo arquivado sem posição não é problema de ninguém, e pedir
 * cotação dele gastaria cota para nada.
 */
export type PriceableAsset = {
  readonly asset_id: string;
  readonly ticker: string;
  readonly b3_type: string | null;
  /** A data do lançamento mais antigo: é daí que o backfill parte. */
  readonly first_trade_date: DateOnly;
  /**
   * Só em Tesouro: o par (indexador, vencimento) é como o título público é
   * reconhecido na resposta da fonte, porque nome comercial muda.
   */
  readonly indexer: string | null;
  readonly maturity_date: DateOnly | null;
};
