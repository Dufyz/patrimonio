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
  readonly portfolioId: string;
  readonly groupBy: PositionGroupBy;
  readonly search: string | null;
  readonly categoryId: string | null;
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
  readonly header: PositionViewHeader;
};

export type PositionViewRepository = {
  readonly open: (filter: PositionViewFilter) => Promise<Either<AppError, PositionView>>;
};
