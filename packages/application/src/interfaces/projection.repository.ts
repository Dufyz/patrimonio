import type {
  AssetClass,
  ComputedPriceKind,
  DateOnly,
  PortfolioDaily,
  PositionDaily,
  RealizedResult,
  TaxMonth,
} from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * As tabelas de projeção, escritas só pelo motor. A escrita é sempre em lote:
 * o fechamento diário grava trezentas linhas de `position_daily` numa consulta,
 * e laço de `await` com uma escrita por iteração não é aceito — o banco fica em
 * outra rede, e trezentas idas e voltas é o que transforma um recálculo de dez
 * anos em algo que não termina.
 */
export type PositionDailyWrite = {
  readonly portfolio_id: string;
  readonly asset_id: string;
  readonly position_date: DateOnly;
  readonly quantity: string;
  readonly avg_price: string;
  readonly cost_basis: string;
  readonly market_value: string;
  readonly price_source_kind: ComputedPriceKind;
  readonly accrued_interest: string;
};

export type PortfolioDailyWrite = {
  readonly portfolio_id: string;
  readonly position_date: DateOnly;
  readonly total_value: string;
  readonly net_flow: string;
  readonly income: string;
  readonly payouts: string;
  readonly quota_value: string;
  readonly quota_count: string;
  readonly cumulative_contributions: string;
};

export type RealizedResultWrite = {
  readonly transaction_id: string;
  readonly portfolio_id: string;
  readonly asset_id: string;
  readonly trade_date: DateOnly;
  readonly proceeds: string;
  readonly cost_consumed: string;
  readonly result: string;
  readonly exempt: boolean;
  readonly loss_offset: string;
};

export type TaxMonthWrite = {
  readonly year: number;
  readonly month: number;
  readonly asset_class: AssetClass;
  readonly sales_total: string;
  readonly gross_result: string;
  readonly exempt: boolean;
  readonly loss_carried_forward: string;
};

export type ProjectionRepository = {
  /**
   * Apaga a projeção a partir de uma data, que é o primeiro passo de todo
   * recálculo: reconstruir é apagar e regravar do livro, nunca corrigir no lugar.
   */
  readonly deleteFrom: (
    portfolioId: string,
    fromDate: DateOnly,
  ) => Promise<Either<AppError, { readonly positions: number; readonly days: number }>>;

  readonly upsertPositions: (
    rows: readonly PositionDailyWrite[],
  ) => Promise<Either<AppError, number>>;

  readonly upsertPortfolioDays: (
    rows: readonly PortfolioDailyWrite[],
  ) => Promise<Either<AppError, number>>;

  /**
   * A linha do dia anterior ao início do intervalo: é dela que a série de cota
   * continua, e é o que faz reconstruir um pedaço dar o mesmo resultado que
   * reconstruir tudo.
   */
  readonly lastDayBefore: (
    portfolioId: string,
    date: DateOnly,
  ) => Promise<Either<AppError, PortfolioDaily | null>>;

  readonly listPositionsOn: (
    portfolioId: string,
    date: DateOnly,
  ) => Promise<Either<AppError, PositionDaily[]>>;

  /** O retorno de uma janela lê duas linhas, não duas mil. */
  readonly quotaPointsAt: (
    portfolioId: string,
    dates: readonly DateOnly[],
  ) => Promise<Either<AppError, PortfolioDaily[]>>;

  readonly listDaysBetween: (
    portfolioId: string,
    from: DateOnly,
    to: DateOnly,
  ) => Promise<Either<AppError, PortfolioDaily[]>>;

  /** Substitui o resultado realizado da carteira a partir de uma data. */
  readonly replaceRealized: (
    portfolioId: string,
    fromDate: DateOnly,
    rows: readonly RealizedResultWrite[],
  ) => Promise<Either<AppError, number>>;

  readonly listRealizedBetween: (
    portfolioId: string,
    from: DateOnly,
    to: DateOnly,
  ) => Promise<Either<AppError, RealizedResult[]>>;

  /**
   * A apuração é global, não por carteira: o limite de isenção olha a soma das
   * vendas do mês em todas elas, e `tax_month` não tem coluna de carteira por
   * isso.
   */
  readonly upsertTaxMonths: (
    rows: readonly TaxMonthWrite[],
  ) => Promise<Either<AppError, number>>;

  readonly listTaxMonths: (
    year: number,
  ) => Promise<Either<AppError, TaxMonth[]>>;
};
