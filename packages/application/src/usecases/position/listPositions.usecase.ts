import {
  changeRatio,
  liveValuation,
  shiftSummary,
  sumDeltas,
  valueDelta,
  weightOf,
} from '@patrimonio/calc';
import type { PositionGroupBy } from '@patrimonio/domain';
import { either } from '@patrimonio/shared';

import type { Clock } from '../../interfaces/clock.js';
import type { LiveQuoteSource } from '../../interfaces/live_quotes.js';
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
  /** Nulo significa todas as carteiras ativas. */
  readonly portfolioId: string | null;
  readonly groupBy: PositionGroupBy;
  readonly search: string | null;
  readonly categoryIds: readonly string[];
  readonly institutionIds: readonly string[];
};

export type ListPositionsDeps = {
  readonly positionViews: PositionViewRepository;
  /** O dia de hoje entra pelo relógio injetado, nunca por `new Date()`. */
  readonly clock: Clock;
  /** Cotação de pregão; sem ela, a tela mostra o último fechamento. */
  readonly live?: LiveQuoteSource | undefined;
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
  class_name: row.class_name,
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
      categoryIds: input.categoryIds,
      institutionIds: input.institutionIds,
    });

    const today = deps.clock.today();

    // Só se reavalia o que tem cotação em bolsa e preço mais velho que hoje: o
    // fechamento de hoje, quando já existe, é o que vale.
    const eligible = (row: PositionViewRow): boolean =>
      row.unit === 'quantity' &&
      row.b3_type !== null &&
      row.b3_type !== 'treasury' &&
      row.quantity !== null &&
      (row.price_date === null || row.price_date < today);

    const wanted =
      deps.live === undefined
        ? []
        : [...new Set(view.rows.filter(eligible).map((row) => row.ticker))];

    const reading =
      deps.live === undefined || wanted.length === 0
        ? null
        : await deps.live.read(wanted);

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

    const deltas = new Map<string, string[]>();
    const priced = new Map<string, ReturnType<typeof liveValuation>>();
    let applied = 0;

    if (reading !== null) {
      for (const row of view.rows) {
        const quote = reading.quotes.get(row.ticker);
        if (
          quote === undefined ||
          !eligible(row) ||
          row.quantity === null ||
          quote.price_date <= (row.price_date ?? '')
        ) {
          continue;
        }

        const next = liveValuation({
          quantity: row.quantity,
          cost_basis: row.cost_basis,
          previous_price: row.price,
          live_price: quote.price,
        });

        const key = `${row.portfolio_id}:${row.asset_id}:${row.group_key}`;
        priced.set(key, next);
        applied += 1;

        const bucket = deltas.get(row.group_key) ?? [];
        bucket.push(valueDelta(next.value, row.value));
        deltas.set(row.group_key, bucket);
      }
    }

    const totalDelta = sumDeltas([...deltas.values()].flat());
    const liveTotal = applied === 0 ? total : shiftSummary(total, totalDelta);

    const reprice = (row: PositionViewRow): PositionRow => {
      const base = withoutGroupColumns(row);
      const next = priced.get(`${row.portfolio_id}:${row.asset_id}:${row.group_key}`);

      return next === undefined
        ? {
            ...base,
            weight: applied === 0 ? base.weight : weightOf(base.value, liveTotal.value),
          }
        : {
            ...base,
            price: next.price,
            price_date: reading?.quotes.get(row.ticker)?.price_date ?? row.price_date,
            value: next.value,
            open_result: next.open_result,
            open_result_ratio: next.open_result_ratio,
            day_change_ratio: next.day_change_ratio,
            weight: weightOf(next.value, liveTotal.value),
          };
    };

    const groupSummary = (key: string): Summary => {
      const base = subtotals.get(key) ?? EMPTY_SUMMARY;
      const group = deltas.get(key);
      if (group === undefined) {
        return applied === 0
          ? base
          : { ...base, weight: weightOf(base.value, liveTotal.value) };
      }

      const shifted = shiftSummary(base, sumDeltas(group));
      return {
        ...base,
        ...shifted,
        weight: weightOf(shifted.value, liveTotal.value),
      };
    };

    const groups = order.map((key) => {
      const rows = byGroup.get(key) ?? [];
      const first = rows[0];

      return {
        key,
        label: first?.group_label ?? '',
        color_token: first?.group_color_token ?? null,
        summary: groupSummary(key),
        positions: rows.map(reprice),
      };
    });

    return {
      as_of: view.header.as_of,
      computed_at: view.header.computed_at,
      group_by: input.groupBy,
      groups,
      total: applied === 0 ? total : { ...total, ...liveTotal },
      day_change_ratio:
        applied === 0
          ? view.header.day_change_ratio
          : changeRatio(liveTotal.value, total.value),
      live:
        reading === null || reading.as_of === null
          ? null
          : { as_of: reading.as_of, applied, requested: wanted.length },
      return_12m_ratio: view.header.return_12m_ratio,
      payouts_12m: view.header.payouts_12m,
      facets: view.facets.map((facet: PositionViewFacetRow) => ({ ...facet })),
      institution_facets: view.institution_facets.map((facet) => ({ ...facet })),
      price_health: {
        fresh: view.header.fresh,
        stale: view.header.stale,
        manual: view.header.manual,
        missing: view.header.missing,
      },
    };
  });
