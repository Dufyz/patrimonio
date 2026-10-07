import type { B3Type, DateOnly, IndexCode, PriceSourceKind } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * O contrato das fontes externas. Nenhum caso de uso conhece o nome de um
 * provedor: ele recebe a cadeia por dependência e trocar a fonte principal é
 * mudar variável de ambiente.
 *
 * Duas decisões moram no retorno, e as duas existem para o mesmo fim — não
 * gravar número errado:
 *
 * - **`missing` é separado de erro.** Um papel que a fonte não conhece não
 *   invalida o lote: o job grava o que veio e marca o resto. Tratar isso como
 *   falha jogaria fora trinta cotações boas por causa de um ticker digitado
 *   errado.
 * - **Ausência nunca é zero.** Um provedor que não sabe o preço devolve o
 *   ticker em `missing`. Um zero gravado por engano zera a posição, e o erro se
 *   propaga por toda a série de `position_daily` até alguém notar.
 *
 * O que um provedor nunca faz: gravar no banco, normalizar moeda, chamar
 * `new Date()` — a data entra como parâmetro — ou tentar para sempre.
 */
export type PriceQuote = {
  readonly ticker: string;
  /** A data do fechamento que a fonte devolveu, que pode não ser a pedida. */
  readonly price_date: DateOnly;
  readonly close: string;
};

export type ClosingResult = {
  readonly quotes: readonly PriceQuote[];
  /** Tickers que a fonte não conhece. Não é erro, e abre alerta. */
  readonly missing: readonly string[];
};

/**
 * Um provedor de cotação. `id` é o que vai para `asset_price.source`: a tela
 * mostra qual fonte respondeu, e o histórico fica auditável.
 */
export type QuoteProvider = {
  readonly id: string;
  readonly supports: readonly B3Type[];
  readonly fetchClosing: (
    tickers: readonly string[],
    date: DateOnly,
  ) => Promise<Either<AppError, ClosingResult>>;
  /**
   * Quantas requisições HTTP a última chamada consumiu. É o que alimenta o
   * orçamento mensal: o plano gratuito da brapi tem teto, e descobrir que ele
   * estourou é descobrir que o patrimônio de amanhã não fecha.
   */
  readonly requestsIn: (tickers: readonly string[]) => number;
  /** A série histórica de um papel, para o backfill. Ausente no provedor que não a serve. */
  readonly fetchHistory?: (
    ticker: string,
    from: DateOnly,
    to: DateOnly,
  ) => Promise<Either<AppError, ClosingResult>>;
};

/** O que a cadeia devolve: o resultado mais quem respondeu. */
export type SourcedClosing = ClosingResult & {
  readonly source: string;
  /** `none` quando toda a cadeia falhou: nada é gravado, e o dia fica marcado. */
  readonly source_kind: PriceSourceKind | 'none';
  /** Requisições consumidas nesta coleta, somando as tentativas. */
  readonly requests: number;
};

/**
 * A cadeia já resolvida, que é o que o caso de uso recebe. Ele não sabe quantos
 * elos existem nem em que ordem.
 */
export type QuoteSource = {
  readonly fetchClosing: (
    tickers: readonly string[],
    date: DateOnly,
  ) => Promise<Either<AppError, SourcedClosing>>;
  readonly fetchHistory: (
    ticker: string,
    from: DateOnly,
    to: DateOnly,
  ) => Promise<Either<AppError, SourcedClosing>>;
};

// ─── Índices ─────────────────────────────────────────────────────────────────

/**
 * Uma observação de índice, já convertida em **fator diário**. A conversão é do
 * provedor porque é ela que conhece a unidade da fonte: a série 12 do Banco
 * Central publica a taxa do dia em percentual, e a 433 publica o IPCA do mês.
 */
export type IndexSample = {
  readonly index_code: IndexCode;
  readonly quote_date: DateOnly;
  readonly daily_factor: string;
  /** O número como a fonte publicou, para conferência. */
  readonly raw_value: string | null;
};

export type IndexProvider = {
  readonly id: string;
  readonly series: readonly IndexCode[];
  /**
   * Os dias úteis entram como parâmetro: distribuir o IPCA do mês pró-rata
   * exige a contagem exata, e dia útil vem do calendário em tabela, nunca de
   * regra.
   */
  readonly fetchSeries: (
    codes: readonly IndexCode[],
    from: DateOnly,
    to: DateOnly,
    businessDays: readonly DateOnly[],
  ) => Promise<Either<AppError, readonly IndexSample[]>>;
};

// ─── Tesouro Direto ──────────────────────────────────────────────────────────

/**
 * O título público é identificado por tipo e vencimento, não por nome
 * comercial: "Tesouro IPCA+ 2029" é texto de marketing e já mudou de forma;
 * `ipca_plus` com vencimento em 2029-05-15 não muda.
 */
export type TreasuryQuote = {
  readonly kind: 'ipca_plus' | 'prefixed' | 'selic_plus';
  readonly maturity_date: DateOnly;
  readonly quote_date: DateOnly;
  /** Preço e taxa das duas pontas, guardados separados. */
  readonly buy_price: string;
  readonly sell_price: string;
  readonly buy_rate: string;
  readonly sell_rate: string;
};

export type TreasuryProvider = {
  readonly id: string;
  readonly fetchQuotes: (
    date: DateOnly,
  ) => Promise<Either<AppError, readonly TreasuryQuote[]>>;
};

export type TreasurySource = {
  readonly fetchQuotes: (date: DateOnly) => Promise<
    Either<
      AppError,
      {
        readonly quotes: readonly TreasuryQuote[];
        readonly source: string;
        readonly source_kind: PriceSourceKind | 'none';
      }
    >
  >;
};

// ─── Proventos e eventos anunciados ──────────────────────────────────────────

export type AnnouncedPayoutSample = {
  readonly ticker: string;
  readonly payout_kind: 'dividend' | 'jcp' | 'income' | 'interest' | 'amortization';
  readonly record_date: DateOnly;
  readonly payment_date: DateOnly | null;
  readonly amount_per_share: string;
};

export type CorporateEventSample = {
  readonly ticker: string;
  readonly kind: 'split' | 'reverse_split' | 'bonus';
  readonly record_date: DateOnly;
  readonly ratio_from: string;
  readonly ratio_to: string;
};

/**
 * Proventos e eventos corporativos anunciados. Nenhuma fonte gratuita cobre
 * isso de forma confiável hoje, e é por isso que o provedor é opcional: sem ele
 * o lançamento continua manual, como já é, e nada no pipeline muda.
 */
export type CorporateActionProvider = {
  readonly id: string;
  readonly fetchAnnouncements: (
    tickers: readonly string[],
    from: DateOnly,
    to: DateOnly,
  ) => Promise<
    Either<
      AppError,
      {
        readonly payouts: readonly AnnouncedPayoutSample[];
        readonly events: readonly CorporateEventSample[];
      }
    >
  >;
};
