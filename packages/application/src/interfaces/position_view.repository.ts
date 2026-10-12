import type {
  AssetOrigin,
  B3Type,
  ComputedPriceKind,
  DateOnly,
  Indexer,
  PositionGroupBy,
  PositionUnit,
} from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * T-02 · A leitura da tela de Posições.
 *
 * É um repositório de leitura, e não uma composição de repositórios de escrita,
 * por causa do orçamento de consultas (T-11): montar a tela a partir de
 * `projections`, `assets`, `categories` e `institutions` custaria uma consulta
 * por ativo, e o banco fica em outra rede. Aqui são **duas** — as linhas e os
 * agregados —, e um teste conta.
 *
 * Nada aqui soma dinheiro em TypeScript. Subtotal, total, peso e contagem saem
 * de `numeric` do Postgres, que é exato; o que o caso de uso faz é organizar o
 * que voltou.
 */
export type PositionViewFilter = {
  /** O dia limite: a tela mostra o último fechamento em ou antes dele. */
  readonly today: DateOnly;
  /** Nulo significa todas as carteiras ativas. */
  readonly portfolioId: string | null;
  readonly groupBy: PositionGroupBy;
  readonly search: string | null;
  /** Qualquer uma delas; `sem-categoria` é a ausência. Vazio não filtra. */
  readonly categoryIds: readonly string[];
  /** Qualquer uma delas; `sem-instituicao` é a ausência. Vazio não filtra. */
  readonly institutionIds: readonly string[];
};

export type PositionViewRow = {
  readonly group_key: string;
  readonly group_label: string;
  readonly group_color_token: string | null;

  readonly portfolio_id: string;
  readonly portfolio_name: string;
  readonly asset_id: string;
  readonly ticker: string;
  readonly name: string;
  readonly origin: AssetOrigin;
  readonly b3_type: B3Type | null;
  readonly institution_id: string | null;
  readonly institution_name: string | null;
  readonly category_id: string | null;
  readonly category_name: string | null;
  readonly color_token: string | null;
  readonly unit: PositionUnit;
  readonly quantity: string | null;
  readonly avg_price: string | null;
  readonly price: string | null;
  readonly price_health: ComputedPriceKind;
  readonly price_date: DateOnly | null;
  readonly value: string;
  readonly cost_basis: string;
  readonly open_result: string;
  readonly open_result_ratio: string | null;
  readonly weight: string;
  readonly day_change_ratio: string | null;
  readonly return_12m_ratio: string | null;
  readonly dividend_yield_12m: string | null;
  readonly indexer: Indexer | null;
  readonly rate: string | null;
  readonly maturity_date: DateOnly | null;
};

/** Um subtotal. `group_key` nulo é o total geral do recorte. */
export type PositionViewSummaryRow = {
  readonly group_key: string | null;
  readonly count: number;
  readonly value: string;
  readonly cost_basis: string;
  readonly open_result: string;
  readonly open_result_ratio: string | null;
  readonly weight: string;
};

export type PositionViewFacetRow = {
  readonly id: string;
  readonly label: string;
  readonly color_token: string | null;
  readonly count: number;
};

export type PositionViewInstitutionFacetRow = {
  readonly id: string;
  readonly label: string;
  readonly count: number;
};

export type PositionViewHeader = {
  readonly as_of: DateOnly | null;
  readonly computed_at: string | null;
  readonly payouts_12m: string;
  /** Da série de cota, e só quando o recorte é uma carteira só. */
  readonly day_change_ratio: string | null;
  readonly return_12m_ratio: string | null;
  readonly fresh: number;
  readonly stale: number;
  readonly manual: number;
  readonly missing: number;
};

export type PositionView = {
  readonly rows: readonly PositionViewRow[];
  readonly summaries: readonly PositionViewSummaryRow[];
  readonly facets: readonly PositionViewFacetRow[];
  readonly institution_facets: readonly PositionViewInstitutionFacetRow[];
  readonly header: PositionViewHeader;
};

export type ClosedPositionFilter = {
  /** Nulo significa todas as carteiras ativas. */
  readonly portfolioId: string | null;
  readonly search: string | null;
};

export type ClosedPositionRow = {
  readonly asset_id: string;
  readonly ticker: string;
  readonly name: string;
  readonly category_name: string | null;
  readonly color_token: string | null;
  readonly first_trade_date: DateOnly;
  readonly closed_on: DateOnly;
  readonly invested: string;
  readonly proceeds: string;
  readonly payouts_received: string;
  readonly realized_result: string | null;
  readonly total_result: string;
  readonly total_result_ratio: string | null;
};

export type PositionViewRepository = {
  readonly open: (filter: PositionViewFilter) => Promise<Either<AppError, PositionView>>;
  /**
   * Os ativos que a carteira já vendeu e não tem mais. Uma consulta: a conta de
   * cada papel (investido, vendido, proventos) é agregada no banco.
   */
  readonly closed: (
    filter: ClosedPositionFilter,
  ) => Promise<Either<AppError, readonly ClosedPositionRow[]>>;
};
