import type { PositionGroupBy } from '@patrimonio/domain';
import { either } from '@patrimonio/shared';

import type { Clock } from '../../interfaces/clock.js';
import type {
  PositionViewFacetRow,
  PositionViewRepository,
  PositionViewRow,
  PositionViewSummaryRow,
} from '../../interfaces/position_view.repository.js';

/**
 * T-02 · As posições abertas hoje, agrupadas como quem olha pediu.
 *
 * O caso de uso não calcula: ele organiza. As somas vêm do Postgres em
 * `numeric`, e refazê-las aqui seria introduzir uma segunda verdade — a que a
 * tela mostra — ao lado da que o banco guarda.
 *
 * Grupo vazio não existe: a resposta só traz grupo com linha. É o que mantém a
 * promessa de O-08 — "nenhum bloco aparece vazio" — sem a tela precisar
 * filtrar nada.
 */
export type ListPositionsInput = {
  readonly portfolioId: string;
  readonly groupBy: PositionGroupBy;
  readonly search: string | null;
  readonly categoryId: string | null;
};

export type ListPositionsDeps = {
  readonly positionViews: PositionViewRepository;
  /** O dia de hoje entra pelo relógio injetado, nunca por `new Date()`. */
  readonly clock: Clock;
};

type Summary = Omit<PositionViewSummaryRow, 'group_key'>;

type PositionRow = Omit<
  PositionViewRow,
  'group_key' | 'group_label' | 'group_color_token'
>;

const EMPTY_SUMMARY: Summary = {
  count: 0,
  value: '0',
  cost_basis: '0',
  open_result: '0',
  open_result_ratio: null,
  weight: '0',
};

/**
 * A linha sem as três colunas que descrevem o grupo dela. Elas existem para o
 * caso de uso montar os grupos e não têm o que fazer na resposta: repeti-las em
 * cada linha seria dizer a mesma coisa vinte e oito vezes.
 */
const withoutGroupColumns = (row: PositionViewRow): PositionRow => ({
  portfolio_id: row.portfolio_id,
  portfolio_name: row.portfolio_name,
  asset_id: row.asset_id,
  ticker: row.ticker,
  name: row.name,
  origin: row.origin,
  b3_type: row.b3_type,
  institution_id: row.institution_id,
  institution_name: row.institution_name,
  category_id: row.category_id,
  category_name: row.category_name,
  color_token: row.color_token,
  unit: row.unit,
  quantity: row.quantity,
  avg_price: row.avg_price,
  price: row.price,
  price_health: row.price_health,
  price_date: row.price_date,
  value: row.value,
  cost_basis: row.cost_basis,
  open_result: row.open_result,
  open_result_ratio: row.open_result_ratio,
  weight: row.weight,
  day_change_ratio: row.day_change_ratio,
  return_12m_ratio: row.return_12m_ratio,
  dividend_yield_12m: row.dividend_yield_12m,
  indexer: row.indexer,
  rate: row.rate,
  maturity_date: row.maturity_date,
});

export const listPositions = (deps: ListPositionsDeps) =>
  either(async function* (input: ListPositionsInput) {
    const view = yield* await deps.positionViews.open({
      today: deps.clock.today(),
      portfolioId: input.portfolioId,
      groupBy: input.groupBy,
      search: input.search,
      categoryId: input.categoryId,
    });

    const subtotals = new Map<string, Summary>();
    let total: Summary = EMPTY_SUMMARY;

    for (const summary of view.summaries) {
      const { group_key: key, ...rest } = summary;
      if (key === null) total = rest;
      else subtotals.set(key, rest);
    }

    const order: string[] = [];
    const byGroup = new Map<string, PositionViewRow[]>();

    for (const row of view.rows) {
      const bucket = byGroup.get(row.group_key);
      if (bucket === undefined) {
        order.push(row.group_key);
        byGroup.set(row.group_key, [row]);
      } else {
        bucket.push(row);
      }
    }

    const groups = order.map((key) => {
      const rows = byGroup.get(key) ?? [];
      const first = rows[0];

      return {
        key,
        label: first?.group_label ?? '',
        color_token: first?.group_color_token ?? null,
        summary: subtotals.get(key) ?? EMPTY_SUMMARY,
        positions: rows.map(withoutGroupColumns),
      };
    });

    return {
      as_of: view.header.as_of,
      computed_at: view.header.computed_at,
      group_by: input.groupBy,
      groups,
      total,
      day_change_ratio: view.header.day_change_ratio,
      return_12m_ratio: view.header.return_12m_ratio,
      payouts_12m: view.header.payouts_12m,
      facets: view.facets.map((facet: PositionViewFacetRow) => ({ ...facet })),
      price_health: {
        fresh: view.header.fresh,
        stale: view.header.stale,
        manual: view.header.manual,
        missing: view.header.missing,
      },
    };
  });
