import type {
  AssetOrigin,
  B3Type,
  ComputedPriceKind,
  CorporateEventKind,
  DateOnly,
  Indexer,
  LiquidityKind,
  PayoutKind,
  PositionUnit,
  PriceSource,
  TaxRegime,
  TransactionKind,
} from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * T-03 · A leitura da página do ativo.
 *
 * Um repositório de leitura, pela razão de T-02 e mais uma. A razão de T-02 é o
 * orçamento de consultas (T-11): montar esta tela a partir de `assets`,
 * `ledger`, `projections`, `prices` e `corporateEvents` custaria sete idas ao
 * banco, que fica em outra rede. A razão nova é que metade do que a tela mostra
 * é agregado — provento por mês, resultado realizado somado, contagem por tipo
 * de lançamento —, e agregado é o que o Postgres faz melhor que TypeScript.
 *
 * São **duas** consultas: a série datada do gráfico, e tudo o resto. Nada aqui
 * soma dinheiro em JavaScript.
 */
export type AssetPagePeriod = '6m' | '1a' | '3a' | 'tudo';

export type AssetPageFilter = {
  /** O dia limite: a tela mostra o último fechamento em ou antes dele. */
  readonly today: DateOnly;
  /** O código do papel ou o identificador dele: a leitura aceita os dois. */
  readonly assetId: string;
  readonly portfolioId: string;
  readonly period: AssetPagePeriod;
  /** Nulo é todos os tipos de lançamento. */
  readonly kind: TransactionKind | null;
};

/** Quantos lançamentos o histórico do ativo mostra antes de "Todos →". */
export const ASSET_PAGE_TRANSACTION_LIMIT = 50;

export type AssetPageIdentityRow = {
  readonly asset_id: string;
  readonly ticker: string;
  readonly name: string;
  readonly origin: AssetOrigin;
  readonly b3_type: B3Type | null;
  readonly sector: string | null;
  readonly price_source: PriceSource;
  readonly category_id: string | null;
  readonly category_name: string | null;
  readonly color_token: string | null;
  readonly category_automatic: boolean;
  readonly issuer_id: string | null;
  readonly issuer_name: string | null;
  readonly archived_at: string | null;
  readonly indexer: Indexer | null;
  readonly rate: string | null;
  readonly issued_at: DateOnly | null;
  readonly maturity_date: DateOnly | null;
  readonly liquidity: LiquidityKind | null;
  readonly liquidity_days: number | null;
  readonly tax_regime: TaxRegime | null;
};

export type AssetPagePositionRow = {
  readonly unit: PositionUnit;
  readonly quantity: string | null;
  readonly avg_price: string | null;
  readonly cost_basis: string;
  readonly value: string;
  readonly open_result: string;
  readonly open_result_ratio: string | null;
  readonly weight: string;
  readonly accrued_interest: string;
  readonly realized_result: string | null;
  readonly payouts_12m: string;
  readonly yield_on_cost_12m: string | null;
};

/**
 * O que o ativo foi na vida da carteira, com ou sem posição aberta. É o que
 * permite abrir um papel já vendido e ainda ver o que ele rendeu.
 */
export type AssetPageLifetimeRow = {
  /** Soma do que foi pago nas compras. */
  readonly invested: string;
  /** Soma do que foi recebido nas vendas. */
  readonly proceeds: string;
  /** Proventos confirmados (amortização inclusa: é dinheiro que entrou). */
  readonly payouts_received: string;
  /** Nulo quando nunca houve venda. */
  readonly realized_result: string | null;
  readonly first_trade_date: DateOnly | null;
  readonly last_trade_date: DateOnly | null;
  readonly buys: number;
  readonly sells: number;
};

/** Um dia da vida do ativo: valor no fim do dia e o dinheiro que passou por ele. */
export type AssetPageReturnDayRow = {
  readonly date: DateOnly;
  readonly value: string;
  /** Compra positiva, venda e amortização negativas. */
  readonly flow: string;
  /** Proventos que não são devolução de capital. */
  readonly income: string;
};

export type AssetPagePriceRow = {
  readonly value: string | null;
  readonly day_change_ratio: string | null;
  readonly price_health: ComputedPriceKind | null;
  readonly price_date: DateOnly | null;
};

/** Um dia da série: o preço de fechamento e o fator de ajuste acumulado. */
export type AssetPagePointRow = {
  readonly price_date: DateOnly;
  readonly close: string;
  readonly adjusted_close: string;
};

/** Um dia do valor da posição: custo e valor na curva (ou na cotação). */
export type AssetPageValueRow = {
  readonly date: DateOnly;
  readonly cost_basis: string;
  readonly value: string;
  readonly result: string;
  readonly payouts: string;
  readonly with_payouts: string;
  readonly result_with_payouts: string;
};

export type AssetPageMarkRow = {
  readonly trade_date: DateOnly;
  readonly side: 'buy' | 'sell';
  readonly quantity: string;
  readonly unit_price: string;
};

export type AssetPagePayoutMonthRow = {
  readonly month: string;
  readonly dividend: string;
  readonly jcp: string;
  readonly income: string;
  readonly interest: string;
  readonly amortization: string;
  readonly total: string;
};

export type AssetPageUpcomingPayoutRow = {
  readonly transaction_id: string;
  readonly settlement_date: DateOnly;
  readonly payout_kind: PayoutKind;
  readonly net_amount: string;
};

export type AssetPageTransactionRow = {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly payout_kind: PayoutKind | null;
  readonly trade_date: DateOnly;
  readonly settlement_date: DateOnly;
  readonly quantity: string;
  readonly unit_price: string;
  readonly net_amount: string;
  readonly fees: string;
  readonly confirmed_at: string | null;
  readonly portfolio_id: string;
  readonly portfolio_name: string;
  readonly institution_name: string | null;
};

export type AssetPageFacetRow = {
  readonly kind: TransactionKind;
  readonly count: number;
};

export type AssetPageCorporateEventRow = {
  readonly id: string;
  readonly kind: CorporateEventKind;
  readonly record_date: DateOnly;
  readonly ratio_from: string;
  readonly ratio_to: string;
  readonly confirmed_at: string | null;
};

export type AssetPagePortfolioRow = {
  readonly portfolio_id: string;
  readonly portfolio_name: string;
  readonly quantity: string | null;
  readonly value: string;
};

export type AssetPageCustodyTransferRow = {
  readonly id: string;
  readonly transfer_date: DateOnly;
  readonly from_institution_id: string;
  readonly from_institution_name: string;
  readonly to_institution_id: string;
  readonly to_institution_name: string;
  readonly note: string | null;
};

export type AssetPageCustodianRow = {
  readonly institution_id: string;
  readonly institution_name: string;
};

/**
 * As medidas da janela do gráfico. A segunda soma os proventos recebidos dentro
 * dela ao preço final, que é o "+21,4% com proventos" da prancha: a diferença
 * entre as duas é o que o papel pagou enquanto esteve em carteira.
 */
export type AssetPageWindowRow = {
  readonly from: DateOnly | null;
  readonly to: DateOnly | null;
  readonly return_ratio: string | null;
  readonly return_with_payouts_ratio: string | null;
  readonly adjusted: boolean;
};

export type AssetPageView = {
  /** Nulo quando o ativo não existe: a rota devolve 404 e não uma tela vazia. */
  readonly asset: AssetPageIdentityRow | null;
  readonly portfolio_name: string | null;
  readonly as_of: DateOnly | null;
  readonly computed_at: string | null;
  readonly price: AssetPagePriceRow;
  /** Nulo sem posição aberta no recorte. O histórico continua existindo. */
  readonly position: AssetPagePositionRow | null;
  readonly lifetime: AssetPageLifetimeRow;
  readonly return_days: readonly AssetPageReturnDayRow[];
  readonly window: AssetPageWindowRow;
  readonly points: readonly AssetPagePointRow[];
  readonly value_days: readonly AssetPageValueRow[];
  readonly marks: readonly AssetPageMarkRow[];
  readonly payout_months: readonly AssetPagePayoutMonthRow[];
  readonly payouts_total_12m: string;
  readonly upcoming_payouts: readonly AssetPageUpcomingPayoutRow[];
  readonly transactions: readonly AssetPageTransactionRow[];
  readonly transactions_total: number;
  readonly transaction_facets: readonly AssetPageFacetRow[];
  readonly corporate_events: readonly AssetPageCorporateEventRow[];
  readonly portfolios: readonly AssetPagePortfolioRow[];
  readonly custodians: readonly AssetPageCustodianRow[];
  readonly custody_transfers: readonly AssetPageCustodyTransferRow[];
};

export type AssetPageRepository = {
  readonly open: (filter: AssetPageFilter) => Promise<Either<AppError, AssetPageView>>;
};
