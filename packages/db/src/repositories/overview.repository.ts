import type {
  OverviewAnchors,
  OverviewCategoryRow,
  OverviewDayRow,
  OverviewPortfolioRow,
  OverviewPositionRow,
  OverviewQuery,
  OverviewRepository,
  OverviewSnapshot,
  OverviewTargetRow,
} from '@patrimonio/application';
import {
  asDateOnly,
  asDateOnlyOrNull,
  asEnum,
  asNumeric,
  asString,
  asStringOrNull,
  COMPUTED_PRICE_KINDS,
  RECALC_STATUSES,
} from '@patrimonio/domain';
import type { Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * A tela de abertura em **uma** consulta.
 *
 * Ela precisa de sete coisas — série do período, três fechamentos de
 * referência, carteiras, posições, composição por categoria e alvo — e o
 * caminho curto seria sete `select`. O banco está em outra rede: sete idas e
 * voltas é a diferença entre a tela abrir e a tela demorar, e é um custo que
 * nenhuma otimização de índice recupera depois.
 *
 * Então é um `select` com CTEs, devolvendo um objeto JSON. O preço disso é
 * esta consulta ser longa; o preço de não fazer assim aparece em toda abertura
 * de tela, todo dia.
 *
 * Três decisões dentro dela que não são óbvias:
 *
 * - **A data de referência é o último fechamento, não hoje.** Sábado mostra o
 *   fechamento de sexta, com a data dita na tela, em vez de uma tela vazia.
 * - **Cada carteira é lida na última data que ela tem.** Uma carteira cujo
 *   recálculo ficou para trás entra com o valor dela, e não desaparece do
 *   consolidado — sumir faria o patrimônio total encolher sem explicação.
 * - **Cota só existe com escopo de carteira.** Somar cota de carteiras
 *   diferentes não significa nada, então o consolidado devolve nulo e quem
 *   calcula o retorno da janela é o caso de uso, que declara o método.
 */
const SEM_CATEGORIA = 'sem-categoria';

const asMoney = (row: Row, column: string): string => asNumeric(row, column);

const parseDay = (row: Row): OverviewDayRow => ({
  position_date: asDateOnly(row, 'position_date'),
  total_value: asMoney(row, 'total_value'),
  net_flow: asMoney(row, 'net_flow'),
  income: asMoney(row, 'income'),
  payouts: asMoney(row, 'payouts'),
  cumulative_contributions: asMoney(row, 'cumulative_contributions'),
  quota_value: row['quota_value'] === null ? null : asNumeric(row, 'quota_value'),
});

const parsePortfolio = (row: Row): OverviewPortfolioRow => ({
  portfolio_id: asString(row, 'portfolio_id'),
  name: asString(row, 'name'),
  purpose: asStringOrNull(row, 'purpose'),
  tolerance_pp: asNumeric(row, 'tolerance_pp'),
  recalc_status: asEnum(row, 'recalc_status', RECALC_STATUSES),
  total_value: row['total_value'] === null ? null : asNumeric(row, 'total_value'),
});

const parsePosition = (row: Row): OverviewPositionRow => ({
  asset_id: asString(row, 'asset_id'),
  ticker: asString(row, 'ticker'),
  name: asString(row, 'name'),
  b3_type: asStringOrNull(row, 'b3_type'),
  color_token: asStringOrNull(row, 'color_token'),
  value: asMoney(row, 'value'),
  price_source_kind: asEnum(row, 'price_source_kind', COMPUTED_PRICE_KINDS),
});

const parseCategory = (row: Row): OverviewCategoryRow => ({
  category_id: asString(row, 'category_id'),
  category_name: asString(row, 'category_name'),
  group_id: asStringOrNull(row, 'group_id'),
  group_name: asStringOrNull(row, 'group_name'),
  color_token: asString(row, 'color_token'),
  value: asMoney(row, 'value'),
});

const parseTarget = (row: Row): OverviewTargetRow => ({
  category_id: asString(row, 'category_id'),
  target_pct: asNumeric(row, 'target_pct'),
});

const asRows = (value: unknown): readonly Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const anchorsOf = (rows: readonly Row[]): OverviewAnchors => {
  const byKind = new Map(rows.map((row) => [asString(row, 'kind'), parseDay(row)]));

  return {
    previous_day: byKind.get('previous_day') ?? null,
    month_base: byKind.get('month_base') ?? null,
    window_base: byKind.get('window_base') ?? null,
  };
};

export const createOverviewRepository = (sql: Connection): OverviewRepository => ({
  snapshot: async (query: OverviewQuery) => {
    const scope = query.portfolio_id;

    try {
      const [row] = await sql<Row[]>`
        WITH scope AS (
          SELECT p.id
            FROM portfolio p
           WHERE p.archived_at IS NULL
             AND (${scope}::UUID IS NULL OR p.id = ${scope}::UUID)
        ),
        reference AS (
          SELECT MAX(position_date) AS position_date
            FROM portfolio_daily
           WHERE portfolio_id IN (SELECT id FROM scope)
             AND position_date <= ${query.on_date}::DATE
        ),
        inception AS (
          SELECT MIN(position_date) AS position_date
            FROM portfolio_daily
           WHERE portfolio_id IN (SELECT id FROM scope)
        ),
        series AS (
          SELECT position_date,
                 SUM(total_value)::TEXT AS total_value,
                 SUM(net_flow)::TEXT AS net_flow,
                 SUM(income)::TEXT AS income,
                 SUM(payouts)::TEXT AS payouts,
                 SUM(cumulative_contributions)::TEXT AS cumulative_contributions,
                 CASE
                   WHEN ${scope}::UUID IS NULL THEN NULL
                   ELSE MIN(quota_value)::TEXT
                 END AS quota_value
            FROM portfolio_daily
           WHERE portfolio_id IN (SELECT id FROM scope)
             AND position_date BETWEEN ${query.from}::DATE AND ${query.to}::DATE
           GROUP BY position_date
        ),
        anchor_date AS (
          SELECT 'previous_day' AS kind,
                 (SELECT MAX(position_date)
                    FROM portfolio_daily
                   WHERE portfolio_id IN (SELECT id FROM scope)
                     AND position_date < (SELECT position_date FROM reference)
                 ) AS position_date
          UNION ALL
          SELECT 'month_base',
                 (SELECT MAX(position_date)
                    FROM portfolio_daily
                   WHERE portfolio_id IN (SELECT id FROM scope)
                     AND position_date
                         < DATE_TRUNC('month', (SELECT position_date FROM reference))::DATE
                 )
          UNION ALL
          SELECT 'window_base',
                 (SELECT MAX(position_date)
                    FROM portfolio_daily
                   WHERE portfolio_id IN (SELECT id FROM scope)
                     AND position_date < ${query.from}::DATE
                 )
        ),
        anchors AS (
          SELECT a.kind,
                 day.position_date,
                 SUM(day.total_value)::TEXT AS total_value,
                 SUM(day.net_flow)::TEXT AS net_flow,
                 SUM(day.income)::TEXT AS income,
                 SUM(day.payouts)::TEXT AS payouts,
                 SUM(day.cumulative_contributions)::TEXT AS cumulative_contributions,
                 CASE
                   WHEN ${scope}::UUID IS NULL THEN NULL
                   ELSE MIN(day.quota_value)::TEXT
                 END AS quota_value
            FROM anchor_date a
            JOIN portfolio_daily day
              ON day.position_date = a.position_date
             AND day.portfolio_id IN (SELECT id FROM scope)
           GROUP BY a.kind, day.position_date
        ),
        portfolios AS (
          SELECT p.id::TEXT AS portfolio_id,
                 p.name,
                 p.purpose,
                 p.tolerance_pp::TEXT AS tolerance_pp,
                 p.recalc_status,
                 (SELECT day.total_value::TEXT
                    FROM portfolio_daily day
                   WHERE day.portfolio_id = p.id
                     AND day.position_date <= ${query.on_date}::DATE
                   ORDER BY day.position_date DESC
                   LIMIT 1) AS total_value,
                 p.sort_order
            FROM portfolio p
           WHERE p.archived_at IS NULL
        ),
        -- Cada carteira na última data que ela tem até a referência: recálculo
        -- atrasado em uma carteira não pode sumir com ela do consolidado.
        last_position_date AS (
          SELECT held.portfolio_id, MAX(held.position_date) AS position_date
            FROM position_daily held
            JOIN scope s ON s.id = held.portfolio_id
           WHERE held.position_date <= (SELECT position_date FROM reference)
           GROUP BY held.portfolio_id
        ),
        held AS (
          SELECT pos.*
            FROM position_daily pos
            JOIN last_position_date latest
              ON latest.portfolio_id = pos.portfolio_id
             AND latest.position_date = pos.position_date
        ),
        positions AS (
          SELECT held.asset_id::TEXT AS asset_id,
                 asset.ticker,
                 asset.name,
                 asset.b3_type,
                 category.color_token,
                 SUM(held.market_value)::TEXT AS value,
                 -- O pior estado entre as carteiras: um papel sem preço em uma
                 -- delas é um papel sem preço na tela.
                 MIN(
                   CASE held.price_source_kind
                     WHEN 'missing' THEN 1
                     WHEN 'stale' THEN 2
                     WHEN 'manual' THEN 3
                     ELSE 4
                   END
                 ) AS health
            FROM held
            JOIN asset ON asset.id = held.asset_id
            LEFT JOIN category ON category.id = asset.category_id
           GROUP BY held.asset_id, asset.ticker, asset.name, asset.b3_type,
                    category.color_token
          HAVING SUM(held.quantity) <> 0
        ),
        categories AS (
          SELECT COALESCE(category.id::TEXT, ${SEM_CATEGORIA}) AS category_id,
                 COALESCE(category.name, 'Sem categoria') AS category_name,
                 parent.id::TEXT AS group_id,
                 parent.name AS group_name,
                 COALESCE(category.color_token, 'class.outros') AS color_token,
                 SUM(held.market_value)::TEXT AS value
            FROM held
            JOIN asset ON asset.id = held.asset_id
            LEFT JOIN category ON category.id = asset.category_id
            LEFT JOIN category parent ON parent.id = category.parent_id
           GROUP BY category.id, category.name, parent.id, parent.name,
                    category.color_token
          HAVING SUM(held.quantity) <> 0
        ),
        targets AS (
          SELECT target.category_id::TEXT AS category_id,
                 target.target_pct::TEXT AS target_pct
            FROM strategy_target target
           WHERE ${scope}::UUID IS NOT NULL
             AND target.portfolio_id = ${scope}::UUID
        )
        SELECT (SELECT position_date FROM reference) AS reference_date,
               (SELECT position_date FROM inception) AS inception,
               COALESCE((
                 SELECT JSONB_AGG(TO_JSONB(series) ORDER BY series.position_date)
                   FROM series
               ), '[]'::JSONB) AS days,
               COALESCE((
                 SELECT JSONB_AGG(TO_JSONB(anchors)) FROM anchors
               ), '[]'::JSONB) AS anchors,
               COALESCE((
                 SELECT JSONB_AGG(
                          TO_JSONB(portfolios) - 'sort_order'
                          ORDER BY portfolios.sort_order, portfolios.name
                        )
                   FROM portfolios
               ), '[]'::JSONB) AS portfolios,
               COALESCE((
                 SELECT JSONB_AGG(
                          TO_JSONB(positions) - 'health'
                          || JSONB_BUILD_OBJECT(
                               'price_source_kind',
                               CASE positions.health
                                 WHEN 1 THEN 'missing'
                                 WHEN 2 THEN 'stale'
                                 WHEN 3 THEN 'manual'
                                 ELSE 'fresh'
                               END
                             )
                          ORDER BY positions.value::NUMERIC DESC
                        )
                   FROM positions
               ), '[]'::JSONB) AS positions,
               COALESCE((
                 SELECT JSONB_AGG(TO_JSONB(categories) ORDER BY categories.value::NUMERIC DESC)
                   FROM categories
               ), '[]'::JSONB) AS categories,
               COALESCE((
                 SELECT JSONB_AGG(TO_JSONB(targets)) FROM targets
               ), '[]'::JSONB) AS targets
      `;

      if (row === undefined) {
        return failure(
          getRepositoryError(new Error('a consulta da visão geral não devolveu linha')),
        );
      }

      const snapshot: OverviewSnapshot = {
        reference_date: asDateOnlyOrNull(row, 'reference_date'),
        inception: asDateOnlyOrNull(row, 'inception'),
        days: asRows(row['days']).map(parseDay),
        anchors: anchorsOf(asRows(row['anchors'])),
        portfolios: asRows(row['portfolios']).map(parsePortfolio),
        positions: asRows(row['positions']).map(parsePosition),
        categories: asRows(row['categories']).map(parseCategory),
        targets: asRows(row['targets']).map(parseTarget),
      };

      return success(snapshot);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
