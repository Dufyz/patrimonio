import type { B3Type, DateOnly, PayoutKind, TransactionKind } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * T-04 · A leitura do extrato.
 *
 * Um repositório de leitura, pelas razões de T-02 e T-03: o orçamento de
 * consultas por rota (T-11) e o fato de que metade do que a tela mostra é
 * agregado — resumo do período, subtotal de mês, contagem por tipo —, que o
 * Postgres soma melhor e com o mesmo `numeric` que guarda.
 *
 * São **duas** consultas, e a segunda depende da primeira: `page` traz a página
 * de lançamentos e todos os agregados; `history` traz o livro dos ativos que
 * aparecem nela, para o motor refazer o preço médio e dizer o que cada
 * lançamento mudou. Nenhuma soma de dinheiro acontece em JavaScript.
 */

/** Os tipos como as pastilhas os agrupam. A fonte da verdade é o contrato. */
export type StatementGroupKey = 'buy' | 'sell' | 'payout' | 'cash' | 'transfer' | 'event';

export type StatementFilter = {
  /** Nulo significa todas as carteiras ativas. */
  readonly portfolioId: string | null;
  readonly institutionId: string | null;
  /** Nulo é "Todos". */
  readonly group: StatementGroupKey | null;
  /** Casa com código e nome do ativo. */
  readonly search: string | null;
  readonly from: DateOnly | null;
  readonly to: DateOnly | null;
  readonly page: number;
  readonly limit: number;
};

/**
 * Uma linha como o banco a entrega: o lançamento, o nome de quem ele aponta e
 * dois fatos que só o recálculo grava — se a venda ficou isenta e qual é a
 * carteira do outro lado de uma transferência.
 */
export type StatementLedgerRow = {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly payout_kind: PayoutKind | null;
  readonly trade_date: DateOnly;
  readonly settlement_date: DateOnly;
  readonly portfolio_id: string;
  readonly portfolio_name: string;
  readonly institution_id: string;
  readonly institution_name: string | null;
  readonly asset_id: string | null;
  readonly ticker: string | null;
  readonly asset_name: string | null;
  readonly b3_type: B3Type | null;
  readonly quantity: string;
  readonly unit_price: string;
  readonly fees: string;
  readonly gross_amount: string;
  readonly tax_withheld: string;
  readonly net_amount: string;
  readonly expected_net_amount: string | null;
  readonly confirmed_at: string | null;
  readonly transfer_group_id: string | null;
  readonly event_ratio_from: string | null;
  readonly event_ratio_to: string | null;
  readonly note: string | null;
  /** Nulo quando a venda ainda não passou pelo recálculo. */
  readonly realized_exempt: boolean | null;
  /** A carteira da outra perna de uma transferência. */
  readonly transfer_counterpart: string | null;
};

export type StatementSummaryRow = {
  readonly count: number;
  readonly deposits: string;
  readonly withdrawals: string;
  readonly buys: string;
  readonly sells: string;
  readonly payouts: string;
};

export type StatementMonthRow = StatementSummaryRow & {
  /** `AAAA-MM`. */
  readonly month: string;
};

/** O livro de um ativo numa carteira: o que o motor precisa para reaplicar. */
export type StatementHistoryRow = {
  readonly id: string;
  readonly portfolio_id: string;
  readonly asset_id: string;
  readonly kind: TransactionKind;
  readonly trade_date: DateOnly;
  readonly quantity: string;
  readonly unit_price: string;
  readonly fees: string;
  readonly net_amount: string;
  readonly payout_kind: PayoutKind | null;
  readonly event_ratio_from: string | null;
  readonly event_ratio_to: string | null;
};

export type StatementPair = {
  readonly portfolio_id: string;
  readonly asset_id: string;
};

export type StatementPageView = {
  readonly scope: {
    readonly portfolio_id: string | null;
    readonly portfolio_name: string | null;
    readonly entries_total: number;
    readonly first_trade_date: DateOnly | null;
  };
  readonly summary: StatementSummaryRow;
  readonly facets: readonly {
    readonly group: StatementGroupKey;
    readonly count: number;
  }[];
  readonly facets_total: number;
  readonly institutions: readonly {
    readonly id: string;
    readonly name: string;
    readonly count: number;
  }[];
  readonly months: readonly StatementMonthRow[];
  readonly total: number;
  readonly rows: readonly StatementLedgerRow[];
  readonly earlier: { readonly month: string; readonly count: number } | null;
  readonly recalculation: { readonly pending: number; readonly failed: number };
};

export type StatementRepository = {
  readonly page: (
    filter: StatementFilter,
  ) => Promise<Either<AppError, StatementPageView>>;

  /**
   * O livro dos pares carteira × ativo, até a data dada. Lista vazia não vai ao
   * banco: uma página sem ativo não paga a segunda consulta.
   */
  readonly history: (
    pairs: readonly StatementPair[],
    until: DateOnly,
  ) => Promise<Either<AppError, readonly StatementHistoryRow[]>>;
};
