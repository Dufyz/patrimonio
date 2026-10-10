import type { B3Type, DateOnly, PayoutKind, TransactionKind } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * T-09 · A leitura da busca global.
 *
 * Um repositório de leitura, pelas razões de T-02 a T-04: o orçamento de
 * consultas por rota (T-11) e o fato de que o que a paleta mostra é agregado —
 * a quantidade e o valor que a pessoa tem de um ativo vêm do último dia de
 * `position_daily`, somado entre carteiras.
 *
 * São **duas** consultas, independentes entre si: uma para ativos, outra para
 * lançamentos. Nenhuma depende do resultado da outra, então o repositório as
 * dispara juntas; o que o orçamento conta é quantas, e a resposta é duas.
 */

export type SearchFilter = {
  /** O texto já aparado. Nunca vazio: busca sem texto não vai ao banco. */
  readonly text: string;
  /** Nulo significa todas as carteiras ativas. */
  readonly portfolioId: string | null;
  /** Quantos resultados cabem por grupo. */
  readonly limit: number;
};

export type SearchAssetRow = {
  readonly id: string;
  readonly ticker: string;
  readonly name: string;
  readonly b3_type: B3Type | null;
  /** Nulos juntos: ou há posição no escopo, ou não há. */
  readonly quantity: string | null;
  readonly market_value: string | null;
  readonly portfolio_names: readonly string[];
};

export type SearchTransactionRow = {
  readonly id: string;
  readonly kind: TransactionKind;
  readonly payout_kind: PayoutKind | null;
  readonly trade_date: DateOnly;
  readonly portfolio_id: string;
  readonly portfolio_name: string;
  readonly asset_id: string | null;
  readonly ticker: string | null;
  readonly asset_name: string | null;
  readonly b3_type: B3Type | null;
  readonly quantity: string;
  readonly net_amount: string;
  readonly confirmed_at: string | null;
};

export type SearchPageView = {
  readonly assets: {
    readonly total: number;
    readonly rows: readonly SearchAssetRow[];
  };
  readonly transactions: {
    readonly total: number;
    readonly rows: readonly SearchTransactionRow[];
  };
};

export type SearchRepository = {
  readonly find: (filter: SearchFilter) => Promise<Either<AppError, SearchPageView>>;
};
