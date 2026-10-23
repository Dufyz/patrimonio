import type {
  PerformanceBreakdown,
  PerformanceBreakdownQuery,
  PerformanceCategoryRow,
  PerformanceClassFlow,
  PerformanceClassValue,
  PerformanceDayRow,
  PerformancePortfolioPoint,
  PerformancePortfolioName,
  PerformanceSnapshotPortfolio,
  PerformanceRepository,
  PerformanceSnapshot,
  PerformanceSnapshotQuery,
} from '@patrimonio/application';
import {
  asDateOnly,
  asDateOnlyOrNull,
  asEnum,
  asNumeric,
  asString,
  asStringOrNull,
  RECALC_STATUSES,
} from '@patrimonio/domain';
import type { Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * A tela de Desempenho em **duas** consultas, e a divisão não é gosto: a
 * segunda precisa de coisas que só a primeira sabe.
 *
 * A primeira devolve a história da carteira. Com ela o
 * caso de uso descobre o último fechamento, o primeiro, as datas-base de cada
 * janela e os índices de que os benchmarks escolhidos dependem — e só então
 * pode pedir à segunda o que depende deles.
 *
 * **A série vem inteira, não só o período do gráfico.** A grade mês por ano
 * mostra todos os anos desde o início. Dez anos são cerca de 2.500 linhas de
 * seis colunas, que é o que o banco devolve sem esforço — e é mais barato que
 * reabrir a conexão para pedir o que faltou.
 */
const SEM_CATEGORIA = 'sem-categoria';

const asRows = (value: unknown): readonly Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const parseDay = (row: Row): PerformanceDayRow => ({
  position_date: asDateOnly(row, 'position_date'),
  total_value: asNumeric(row, 'total_value'),
  net_flow: asNumeric(row, 'net_flow'),
  income: asNumeric(row, 'income'),
  payouts: asNumeric(row, 'payouts'),
  quota_value: row['quota_value'] === null ? null : asNumeric(row, 'quota_value'),
});

const parsePortfolio = (row: Row): PerformanceSnapshotPortfolio => ({
  portfolio_id: asStringOrNull(row, 'portfolio_id'),
  name: asString(row, 'name'),
  recalc_status: asEnum(row, 'recalc_status', RECALC_STATUSES),
  benchmark: asStringOrNull(row, 'benchmark'),
  total_value: row['total_value'] === null ? null : asNumeric(row, 'total_value'),
});

const parseCategory = (row: Row): PerformanceCategoryRow => ({
  category_id: asString(row, 'category_id'),
  name: asString(row, 'name'),
  color_token: asString(row, 'color_token'),
});

const parseClassValue = (row: Row): PerformanceClassValue => ({
  category_id: asString(row, 'category_id'),
  label: asString(row, 'label'),
  value: asNumeric(row, 'value'),
});

const parseClassFlow = (row: Row): PerformanceClassFlow => ({
  category_id: asString(row, 'category_id'),
  trade_date: asDateOnly(row, 'trade_date'),
  flow: asNumeric(row, 'flow'),
  income: asNumeric(row, 'income'),
});

const parsePortfolioRow = (row: Row): PerformancePortfolioName => ({
  portfolio_id: asString(row, 'portfolio_id'),
  name: asString(row, 'name'),
});

const parsePortfolioPoint = (row: Row): PerformancePortfolioPoint => ({
  portfolio_id: asString(row, 'portfolio_id'),
  label: asString(row, 'label'),
  quota_value: row['quota_value'] === null ? null : asNumeric(row, 'quota_value'),
  total_value: asNumeric(row, 'total_value'),
});

/** `{ CDI: { '2026-01-02': '1.000394…' } }` → mapas, como o motor os recebe. */
const parseFactors = (
  value: unknown,
): ReadonlyMap<string, ReadonlyMap<string, string>> => {
  const factors = new Map<string, ReadonlyMap<string, string>>();

  if (typeof value !== 'object' || value === null) return factors;

  for (const [code, byDate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof byDate !== 'object' || byDate === null) continue;

    factors.set(
      code,
      new Map(
        Object.entries(byDate as Record<string, unknown>).map(([date, factor]) => [
          date,
          String(factor),
        ]),
      ),
    );
  }

  return factors;
};

export const createPerformanceRepository = (sql: Connection): PerformanceRepository => ({
  snapshot: async (query: PerformanceSnapshotQuery) => {
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
        everything AS (
          SELECT NULL::TEXT AS portfolio_id,
                 'Todas as carteiras' AS name,
                 COALESCE((
                   SELECT (ARRAY_AGG(
                            p.recalc_status::TEXT
                            ORDER BY CASE p.recalc_status::TEXT
                                       WHEN 'running' THEN 0
                                       WHEN 'queued' THEN 1
                                       WHEN 'failed' THEN 2
                                       ELSE 3
                                     END
                          ))[1]
                     FROM portfolio p
                    WHERE p.id IN (SELECT id FROM scope)
                 ), 'idle') AS recalc_status,
                 NULL::TEXT AS benchmark,
                 (SELECT SUM(total_value)::TEXT
                    FROM portfolio_daily
                   WHERE portfolio_id IN (SELECT id FROM scope)
                     AND position_date = (SELECT position_date FROM reference)
                 ) AS total_value
           WHERE ${scope}::UUID IS NULL
        ),
        series AS (
          SELECT position_date,
                 SUM(total_value)::TEXT AS total_value,
                 SUM(net_flow)::TEXT AS net_flow,
                 SUM(income)::TEXT AS income,
                 SUM(payouts)::TEXT AS payouts,
                 CASE
                   WHEN ${scope}::UUID IS NULL THEN NULL
                   ELSE MIN(quota_value)::TEXT
                 END AS quota_value
            FROM portfolio_daily
           WHERE portfolio_id IN (SELECT id FROM scope)
             AND position_date <= (SELECT position_date FROM reference)
           GROUP BY position_date
        ),
        portfolio AS (
          SELECT p.id::TEXT AS portfolio_id,
                 p.name,
                 p.recalc_status,
                 p.benchmark,
                 (SELECT day.total_value::TEXT
                    FROM portfolio_daily day
                   WHERE day.portfolio_id = p.id
                     AND day.position_date <= (SELECT position_date FROM reference)
                   ORDER BY day.position_date DESC
                   LIMIT 1) AS total_value
            FROM portfolio p
           WHERE p.archived_at IS NULL
             AND p.id = ${scope}::UUID
        )
        SELECT (SELECT position_date FROM reference) AS reference_date,
               (SELECT position_date FROM inception) AS inception,
               COALESCE((
                 SELECT JSONB_AGG(TO_JSONB(series) ORDER BY series.position_date)
                   FROM series
               ), '[]'::JSONB) AS days,
               COALESCE(
                 (SELECT TO_JSONB(portfolio) FROM portfolio),
                 (SELECT TO_JSONB(everything) FROM everything)
               ) AS portfolio
      `;

      if (row === undefined) {
        return failure(
          getRepositoryError(new Error('a consulta de desempenho não devolveu linha')),
        );
      }

      const snapshot: PerformanceSnapshot = {
        reference_date: asDateOnlyOrNull(row, 'reference_date'),
        inception: asDateOnlyOrNull(row, 'inception'),
        days: asRows(row['days']).map(parseDay),
        portfolio:
          row['portfolio'] === null ? null : parsePortfolio(row['portfolio'] as Row),
      };

      return success(snapshot);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  breakdown: async (query: PerformanceBreakdownQuery) => {
    const scope = query.portfolio_id;
    const labels = query.points.map((point) => point.label);
    const dates = query.points.map((point) => point.date);

    try {
      const [row] = await sql<Row[]>`
        WITH scope AS (
          SELECT p.id
            FROM portfolio p
           WHERE p.archived_at IS NULL
             AND (${scope}::UUID IS NULL OR p.id = ${scope}::UUID)
        ),
        points AS (
          SELECT t.label, t.point_date
            FROM UNNEST(${labels}::TEXT[], ${dates}::DATE[]) AS t(label, point_date)
        ),
        -- O valor de cada classe em cada ponto, cada carteira na última data
        -- que ela tem até ele.
        class_values AS (
          SELECT pt.label,
                 COALESCE(cl.id::TEXT, ${SEM_CATEGORIA}) AS category_id,
                 SUM(pos.market_value)::TEXT AS value
            FROM points pt
           CROSS JOIN scope s
            JOIN LATERAL (
              SELECT MAX(day.position_date) AS position_date
                FROM portfolio_daily day
               WHERE day.portfolio_id = s.id
                 AND day.position_date <= pt.point_date
            ) last ON last.position_date IS NOT NULL
            JOIN position_daily pos
              ON pos.portfolio_id = s.id
             AND pos.position_date = last.position_date
            JOIN asset a ON a.id = pos.asset_id
            LEFT JOIN category c ON c.id = a.category_id
            -- A classe é o grupo da categoria; categoria solta é a própria classe.
            LEFT JOIN category cl ON cl.id = COALESCE(c.parent_id, c.id)
           GROUP BY pt.label, cl.id
        ),
        -- O que entrou na classe e o que ela pagou, por dia. Compra e venda
        -- movem a classe com o sinal contrário ao do líquido; a amortização devolve
        -- principal e sai como fluxo, não como rendimento.
        flows AS (
          SELECT COALESCE(cl.id::TEXT, ${SEM_CATEGORIA}) AS category_id,
                 t.trade_date,
                 SUM(
                   CASE t.kind
                     WHEN 'buy' THEN -t.net_amount
                     WHEN 'sell' THEN -t.net_amount
                     WHEN 'payout' THEN
                       CASE WHEN t.payout_kind = 'amortization' THEN -t.net_amount ELSE 0 END
                     ELSE 0
                   END
                 )::NUMERIC(20,2)::TEXT AS flow,
                 SUM(
                   CASE
                     WHEN t.kind = 'payout' AND t.payout_kind IS DISTINCT FROM 'amortization'
                       THEN t.net_amount
                     ELSE 0
                   END
                 )::NUMERIC(20,2)::TEXT AS income
            FROM transaction t
            JOIN asset a ON a.id = t.asset_id
            LEFT JOIN category c ON c.id = a.category_id
            LEFT JOIN category cl ON cl.id = COALESCE(c.parent_id, c.id)
           WHERE t.portfolio_id IN (SELECT id FROM scope)
             AND t.trade_date > ${query.flows_from}::DATE
             AND t.trade_date <= ${query.reference}::DATE
             AND (t.kind <> 'payout' OR t.confirmed_at IS NOT NULL)
           GROUP BY cl.id, t.trade_date
        ),
        used AS (
          SELECT category_id FROM class_values
          UNION
          SELECT category_id FROM flows
        ),
        categories AS (
          SELECT COALESCE(cl.id::TEXT, ${SEM_CATEGORIA}) AS category_id,
                 COALESCE(cl.name, 'Sem categoria') AS name,
                 COALESCE(cl.color_token, 'class.outros') AS color_token
            FROM asset a
            LEFT JOIN category c ON c.id = a.category_id
            LEFT JOIN category cl ON cl.id = COALESCE(c.parent_id, c.id)
           GROUP BY cl.id, cl.name, cl.color_token
          HAVING COALESCE(cl.id::TEXT, ${SEM_CATEGORIA}) IN (SELECT category_id FROM used)
        ),
        -- A cota de cada carteira em cada ponto, para o retorno de cada uma.
        -- Só Todas as carteiras pede: com uma carteira, ela é o próprio escopo.
        portfolio_points AS (
          SELECT s.id::TEXT AS portfolio_id,
                 pt.label,
                 day.quota_value::TEXT AS quota_value,
                 day.total_value::TEXT AS total_value
            FROM points pt
           CROSS JOIN scope s
            JOIN LATERAL (
              SELECT d.quota_value, d.total_value
                FROM portfolio_daily d
               WHERE d.portfolio_id = s.id
                 AND d.position_date <= pt.point_date
               ORDER BY d.position_date DESC
               LIMIT 1
            ) day ON TRUE
           WHERE ${scope}::UUID IS NULL
          UNION ALL
          SELECT s.id::TEXT,
                 'first',
                 day.quota_value::TEXT,
                 day.total_value::TEXT
            FROM scope s
            JOIN LATERAL (
              SELECT d.quota_value, d.total_value
                FROM portfolio_daily d
               WHERE d.portfolio_id = s.id
               ORDER BY d.position_date ASC
               LIMIT 1
            ) day ON TRUE
           WHERE ${scope}::UUID IS NULL
        ),
        portfolios AS (
          SELECT p.id::TEXT AS portfolio_id, p.name, p.sort_order
            FROM portfolio p
           WHERE p.id IN (SELECT id FROM scope)
             AND ${scope}::UUID IS NULL
        ),
        factors AS (
          SELECT q.index_code, q.quote_date, q.daily_factor::TEXT AS daily_factor
            FROM index_quote q
           WHERE q.index_code = ANY(${query.index_codes}::TEXT[])
             AND q.quote_date > ${query.factors_from}::DATE
             AND q.quote_date <= ${query.reference}::DATE
        )
        SELECT COALESCE((
                 SELECT JSONB_OBJECT_AGG(by_code.index_code, by_code.by_date)
                   FROM (
                     SELECT f.index_code,
                            JSONB_OBJECT_AGG(f.quote_date::TEXT, f.daily_factor) AS by_date
                       FROM factors f
                      GROUP BY f.index_code
                   ) by_code
               ), '{}'::JSONB) AS factors,
               COALESCE((SELECT JSONB_AGG(TO_JSONB(categories)) FROM categories),
                        '[]'::JSONB) AS categories,
               COALESCE((SELECT JSONB_AGG(TO_JSONB(class_values)) FROM class_values),
                        '[]'::JSONB) AS class_values,
               COALESCE((SELECT JSONB_AGG(TO_JSONB(flows)) FROM flows),
                        '[]'::JSONB) AS class_flows,
               COALESCE((SELECT JSONB_AGG(TO_JSONB(portfolio_points)) FROM portfolio_points),
                        '[]'::JSONB) AS portfolio_points,
               COALESCE((SELECT JSONB_AGG(
                          TO_JSONB(portfolios) - 'sort_order'
                          ORDER BY portfolios.sort_order, portfolios.name
                        ) FROM portfolios),
                        '[]'::JSONB) AS portfolios
      `;

      if (row === undefined) {
        return failure(
          getRepositoryError(new Error('a consulta de desempenho não devolveu linha')),
        );
      }

      const breakdown: PerformanceBreakdown = {
        factors: parseFactors(row['factors']),
        categories: asRows(row['categories']).map(parseCategory),
        class_values: asRows(row['class_values']).map(parseClassValue),
        class_flows: asRows(row['class_flows']).map(parseClassFlow),
        portfolios: asRows(row['portfolios']).map(parsePortfolioRow),
        portfolio_points: asRows(row['portfolio_points']).map(parsePortfolioPoint),
      };

      return success(breakdown);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
