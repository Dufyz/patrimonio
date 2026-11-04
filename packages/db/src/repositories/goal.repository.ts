import type {
  GoalFlowRow,
  GoalInflationRow,
  GoalOverviewQuery,
  GoalOverviewRow,
  GoalOverviewSnapshot,
  GoalRepository,
  GoalRow,
  GoalSaved,
  GoalSnapshot,
  GoalSnapshotQuery,
  GoalWrite,
} from '@patrimonio/application';
import {
  asBoolean,
  asDateOnly,
  asDateOnlyOrNull,
  asNumeric,
  asNumericOrNull,
  asString,
  asStringOrNull,
} from '@patrimonio/domain';
import type { Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * A tela de Objetivos em **uma** consulta: o objetivo aberto da carteira, o
 * valor dela hoje e no começo, o fluxo mensal recente e o IPCA dos últimos doze
 * meses — tudo sobre a mesma data de referência.
 *
 * - **O objetivo pertence a uma carteira**, e é ela que o mede. Ela tem no máximo
 *   um objetivo aberto: o índice único do banco garante, e a subconsulta escalar
 *   abaixo falharia alto se duas linhas chegassem.
 * - **A carteira lê o seu último fechamento.** Uma carteira com recálculo
 *   atrasado entra com o valor que tem, e `as_of` diz até onde vai o dado.
 * - **O começo do objetivo é o dia em que ele foi criado, ou o primeiro
 *   fechamento, se a história veio depois.** Medir o "esperado hoje" a partir de
 *   uma data sem valor seria partir de zero e declarar um atraso que não houve.
 */
const asRows = (value: unknown): readonly Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const parseFlow = (row: Row): GoalFlowRow => ({
  month: asString(row, 'month'),
  net_flow: asNumeric(row, 'net_flow'),
});

const parseGoal = (row: Row): GoalRow => ({
  goal_id: asString(row, 'goal_id'),
  name: asString(row, 'name'),
  target_amount: asNumeric(row, 'target_amount'),
  target_date: asDateOnly(row, 'target_date'),
  return_assumption: asStringOrNull(row, 'return_assumption'),
  amount_in_today_brl: asBoolean(row, 'amount_in_today_brl'),
  created_on: asDateOnly(row, 'created_on'),
  current_value: asNumeric(row, 'current_value'),
  as_of: asDateOnlyOrNull(row, 'as_of'),
  history_start: asDateOnlyOrNull(row, 'history_start'),
  start_date: asDateOnlyOrNull(row, 'start_date'),
  start_value: asNumericOrNull(row, 'start_value'),
  flows: asRows(row['flows']).map(parseFlow),
});

const asGoal = (value: unknown): GoalRow | null =>
  typeof value === 'object' && value !== null ? parseGoal(value as Row) : null;

const parseInflation = (value: unknown): GoalInflationRow => {
  if (typeof value !== 'object' || value === null) {
    return { factor: null, first_date: null, last_date: null };
  }

  const row = value as Row;

  return {
    factor: asNumericOrNull(row, 'factor'),
    first_date: asDateOnlyOrNull(row, 'first_date'),
    last_date: asDateOnlyOrNull(row, 'last_date'),
  };
};

export const createGoalRepository = (sql: Connection): GoalRepository => ({
  snapshot: async (query: GoalSnapshotQuery) => {
    const draft = query.draft ?? null;

    try {
      const [row] = await sql<Row[]>`
        WITH goal_rows AS (
          SELECT g.id,
                 g.name,
                 g.target_amount,
                 g.target_date,
                 g.return_assumption,
                 g.amount_in_today_brl,
                 g.created_at::DATE AS created_on
            FROM goal g
            JOIN portfolio p ON p.id = g.portfolio_id
           WHERE g.closed_at IS NULL
             AND p.archived_at IS NULL
             AND g.portfolio_id = ${query.portfolio_id}::UUID
             AND ${draft === null}::BOOLEAN
          UNION ALL
          SELECT COALESCE(g.id, GEN_RANDOM_UUID()),
                 ${draft?.name ?? null}::TEXT,
                 ${draft?.target_amount ?? null}::NUMERIC(20,2),
                 ${draft?.target_date ?? null}::DATE,
                 ${draft?.return_assumption ?? null}::TEXT,
                 ${draft?.amount_in_today_brl ?? null}::BOOLEAN,
                 COALESCE(g.created_at::DATE, ${query.on_date}::DATE)
            FROM portfolio p
            LEFT JOIN goal g ON g.portfolio_id = p.id AND g.closed_at IS NULL
           WHERE p.id = ${query.portfolio_id}::UUID
             AND p.archived_at IS NULL
             AND ${draft !== null}::BOOLEAN
        ),
        latest AS (
          SELECT r.id AS goal_id, d.position_date, d.total_value
            FROM goal_rows r
            LEFT JOIN LATERAL (
              SELECT day.position_date, day.total_value
                FROM portfolio_daily day
               WHERE day.portfolio_id = ${query.portfolio_id}::UUID
                 AND day.position_date <= ${query.on_date}::DATE
               ORDER BY day.position_date DESC
               LIMIT 1
            ) d ON TRUE
        ),
        firsts AS (
          SELECT r.id AS goal_id, first_close.position_date AS first_date
            FROM goal_rows r
           CROSS JOIN LATERAL (
              SELECT day.position_date
                FROM portfolio_daily day
               WHERE day.portfolio_id = ${query.portfolio_id}::UUID
                 AND day.position_date <= ${query.on_date}::DATE
               ORDER BY day.position_date ASC
               LIMIT 1
            ) first_close
        ),
        starts AS (
          SELECT r.id AS goal_id,
                 GREATEST(LEAST(r.created_on, ${query.on_date}::DATE), f.first_date)
                   AS start_date
            FROM goal_rows r
            JOIN firsts f ON f.goal_id = r.id
        ),
        start_values AS (
          SELECT s.goal_id,
                 s.start_date,
                 COALESCE(v.total_value, 0) AS start_value
            FROM starts s
            LEFT JOIN LATERAL (
              SELECT day.total_value
                FROM portfolio_daily day
               WHERE day.portfolio_id = ${query.portfolio_id}::UUID
                 AND day.position_date <= s.start_date
               ORDER BY day.position_date DESC
               LIMIT 1
            ) v ON TRUE
        ),
        flows AS (
          SELECT r.id AS goal_id,
                 TO_CHAR(day.position_date, 'YYYY-MM') AS month,
                 SUM(day.net_flow) AS net_flow
            FROM goal_rows r
            JOIN portfolio_daily day ON day.portfolio_id = ${query.portfolio_id}::UUID
           WHERE day.position_date >=
                   (DATE_TRUNC('month', ${query.on_date}::DATE) - INTERVAL '12 months')::DATE
             AND day.position_date <= ${query.on_date}::DATE
           GROUP BY r.id, TO_CHAR(day.position_date, 'YYYY-MM')
          HAVING SUM(day.net_flow) <> 0
        )
        SELECT (
                 SELECT JSONB_BUILD_OBJECT('portfolio_id', p.id::TEXT, 'name', p.name)
                   FROM portfolio p
                  WHERE p.id = ${query.portfolio_id}::UUID
                    AND p.archived_at IS NULL
               ) AS scope_portfolio,
               (
                 SELECT JSONB_BUILD_OBJECT(
                          'goal_id', r.id::TEXT,
                          'name', r.name,
                          'target_amount', r.target_amount::TEXT,
                          'target_date', TO_CHAR(r.target_date, 'YYYY-MM-DD'),
                          'return_assumption', r.return_assumption,
                          'amount_in_today_brl', r.amount_in_today_brl,
                          'created_on', TO_CHAR(r.created_on, 'YYYY-MM-DD'),
                          'current_value', COALESCE((
                            SELECT SUM(l.total_value) FROM latest l WHERE l.goal_id = r.id
                          ), 0)::TEXT,
                          'as_of', (
                            SELECT TO_CHAR(MAX(l.position_date), 'YYYY-MM-DD')
                              FROM latest l
                             WHERE l.goal_id = r.id
                          ),
                          'history_start', (
                            SELECT TO_CHAR(f.first_date, 'YYYY-MM-DD')
                              FROM firsts f
                             WHERE f.goal_id = r.id
                          ),
                          'start_date', (
                            SELECT TO_CHAR(sv.start_date, 'YYYY-MM-DD')
                              FROM start_values sv
                             WHERE sv.goal_id = r.id
                          ),
                          'start_value', (
                            SELECT sv.start_value::TEXT
                              FROM start_values sv
                             WHERE sv.goal_id = r.id
                          ),
                          'flows', COALESCE((
                            SELECT JSONB_AGG(
                                     JSONB_BUILD_OBJECT(
                                       'month', fl.month,
                                       'net_flow', fl.net_flow::TEXT
                                     )
                                     ORDER BY fl.month
                                   )
                              FROM flows fl
                             WHERE fl.goal_id = r.id
                          ), '[]'::JSONB)
                        )
                   FROM goal_rows r
               ) AS goal,
               (
                 SELECT JSONB_BUILD_OBJECT(
                          'factor', EXP(SUM(LN(q.daily_factor)))::TEXT,
                          'first_date', TO_CHAR(MIN(q.quote_date), 'YYYY-MM-DD'),
                          'last_date', TO_CHAR(MAX(q.quote_date), 'YYYY-MM-DD')
                        )
                   FROM index_quote q
                  WHERE q.index_code = 'IPCA'
                    AND q.quote_date > (${query.on_date}::DATE - INTERVAL '12 months')::DATE
                    AND q.quote_date <= ${query.on_date}::DATE
               ) AS inflation
      `;

      if (row === undefined) {
        return failure(
          getRepositoryError(new Error('a consulta dos objetivos não devolveu linha')),
        );
      }

      const scope = row['scope_portfolio'];

      const snapshot: GoalSnapshot = {
        scope_portfolio:
          scope === null || scope === undefined
            ? null
            : {
                portfolio_id: asString(scope as Row, 'portfolio_id'),
                name: asString(scope as Row, 'name'),
              },
        goal: asGoal(row['goal']),
        inflation: parseInflation(row['inflation']),
      };

      return success(snapshot);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  overview: async (query: GoalOverviewQuery) => {
    try {
      const [row] = await sql<Row[]>`
        WITH goal_rows AS (
          SELECT p.id AS portfolio_id,
                 p.name AS portfolio_name,
                 p.sort_order,
                 g.id,
                 g.name,
                 g.target_amount,
                 g.target_date,
                 g.return_assumption,
                 g.amount_in_today_brl,
                 g.created_at::DATE AS created_on
            FROM portfolio p
            LEFT JOIN goal g ON g.portfolio_id = p.id AND g.closed_at IS NULL
           WHERE p.archived_at IS NULL
        ),
        latest AS (
          SELECT r.portfolio_id, d.position_date, d.total_value
            FROM goal_rows r
            LEFT JOIN LATERAL (
              SELECT day.position_date, day.total_value
                FROM portfolio_daily day
               WHERE day.portfolio_id = r.portfolio_id
                 AND day.position_date <= ${query.on_date}::DATE
               ORDER BY day.position_date DESC
               LIMIT 1
            ) d ON TRUE
           WHERE r.id IS NOT NULL
        ),
        firsts AS (
          SELECT r.portfolio_id, first_close.position_date AS first_date
            FROM goal_rows r
           CROSS JOIN LATERAL (
              SELECT day.position_date
                FROM portfolio_daily day
               WHERE day.portfolio_id = r.portfolio_id
                 AND day.position_date <= ${query.on_date}::DATE
               ORDER BY day.position_date ASC
               LIMIT 1
            ) first_close
           WHERE r.id IS NOT NULL
        ),
        starts AS (
          SELECT r.portfolio_id,
                 GREATEST(LEAST(r.created_on, ${query.on_date}::DATE), f.first_date)
                   AS start_date
            FROM goal_rows r
            JOIN firsts f ON f.portfolio_id = r.portfolio_id
           WHERE r.id IS NOT NULL
        ),
        start_values AS (
          SELECT s.portfolio_id,
                 s.start_date,
                 COALESCE(v.total_value, 0) AS start_value
            FROM starts s
            LEFT JOIN LATERAL (
              SELECT day.total_value
                FROM portfolio_daily day
               WHERE day.portfolio_id = s.portfolio_id
                 AND day.position_date <= s.start_date
               ORDER BY day.position_date DESC
               LIMIT 1
            ) v ON TRUE
        ),
        flows AS (
          SELECT r.portfolio_id,
                 TO_CHAR(day.position_date, 'YYYY-MM') AS month,
                 SUM(day.net_flow) AS net_flow
            FROM goal_rows r
            JOIN portfolio_daily day ON day.portfolio_id = r.portfolio_id
           WHERE r.id IS NOT NULL
             AND day.position_date >=
                   (DATE_TRUNC('month', ${query.on_date}::DATE) - INTERVAL '12 months')::DATE
             AND day.position_date <= ${query.on_date}::DATE
           GROUP BY r.portfolio_id, TO_CHAR(day.position_date, 'YYYY-MM')
          HAVING SUM(day.net_flow) <> 0
        )
        SELECT COALESCE((
                 SELECT JSONB_AGG(
                          JSONB_BUILD_OBJECT(
                            'portfolio_id', r.portfolio_id::TEXT,
                            'portfolio_name', r.portfolio_name,
                            'goal', CASE WHEN r.id IS NULL THEN NULL ELSE
                              JSONB_BUILD_OBJECT(
                                'goal_id', r.id::TEXT,
                                'name', r.name,
                                'target_amount', r.target_amount::TEXT,
                                'target_date', TO_CHAR(r.target_date, 'YYYY-MM-DD'),
                                'return_assumption', r.return_assumption,
                                'amount_in_today_brl', r.amount_in_today_brl,
                                'created_on', TO_CHAR(r.created_on, 'YYYY-MM-DD'),
                                'current_value', COALESCE((
                                  SELECT l.total_value FROM latest l
                                   WHERE l.portfolio_id = r.portfolio_id
                                ), 0)::TEXT,
                                'as_of', (
                                  SELECT TO_CHAR(l.position_date, 'YYYY-MM-DD')
                                    FROM latest l
                                   WHERE l.portfolio_id = r.portfolio_id
                                ),
                                'history_start', (
                                  SELECT TO_CHAR(f.first_date, 'YYYY-MM-DD')
                                    FROM firsts f
                                   WHERE f.portfolio_id = r.portfolio_id
                                ),
                                'start_date', (
                                  SELECT TO_CHAR(sv.start_date, 'YYYY-MM-DD')
                                    FROM start_values sv
                                   WHERE sv.portfolio_id = r.portfolio_id
                                ),
                                'start_value', (
                                  SELECT sv.start_value::TEXT
                                    FROM start_values sv
                                   WHERE sv.portfolio_id = r.portfolio_id
                                ),
                                'flows', COALESCE((
                                  SELECT JSONB_AGG(
                                           JSONB_BUILD_OBJECT(
                                             'month', fl.month,
                                             'net_flow', fl.net_flow::TEXT
                                           )
                                           ORDER BY fl.month
                                         )
                                    FROM flows fl
                                   WHERE fl.portfolio_id = r.portfolio_id
                                ), '[]'::JSONB)
                              )
                            END
                          )
                          ORDER BY r.sort_order, LOWER(r.portfolio_name)
                        )
                   FROM goal_rows r
               ), '[]'::JSONB) AS portfolios,
               (
                 SELECT JSONB_BUILD_OBJECT(
                          'factor', EXP(SUM(LN(q.daily_factor)))::TEXT,
                          'first_date', TO_CHAR(MIN(q.quote_date), 'YYYY-MM-DD'),
                          'last_date', TO_CHAR(MAX(q.quote_date), 'YYYY-MM-DD')
                        )
                   FROM index_quote q
                  WHERE q.index_code = 'IPCA'
                    AND q.quote_date > (${query.on_date}::DATE - INTERVAL '12 months')::DATE
                    AND q.quote_date <= ${query.on_date}::DATE
               ) AS inflation
      `;

      if (row === undefined) {
        return failure(
          getRepositoryError(new Error('a consulta dos objetivos não devolveu linha')),
        );
      }

      const portfolios: readonly GoalOverviewRow[] = asRows(row['portfolios']).map(
        (portfolio) => ({
          portfolio_id: asString(portfolio, 'portfolio_id'),
          portfolio_name: asString(portfolio, 'portfolio_name'),
          goal: asGoal(portfolio['goal']),
        }),
      );

      const snapshot: GoalOverviewSnapshot = {
        portfolios,
        inflation: parseInflation(row['inflation']),
      };

      return success(snapshot);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  save: async (portfolioId: string, write: GoalWrite) => {
    try {
      const [row] = await sql<Row[]>`
        INSERT INTO goal (
          id, portfolio_id, name, target_amount, target_date, return_assumption,
          amount_in_today_brl
        )
        VALUES (
          ${uuidv7()}::UUID,
          ${portfolioId}::UUID,
          ${write.name}::TEXT,
          ${write.target_amount}::NUMERIC(20,2),
          ${write.target_date}::DATE,
          ${write.return_assumption}::TEXT,
          ${write.amount_in_today_brl}::BOOLEAN
        )
        ON CONFLICT (portfolio_id) WHERE closed_at IS NULL
        DO UPDATE SET name = EXCLUDED.name,
                      target_amount = EXCLUDED.target_amount,
                      target_date = EXCLUDED.target_date,
                      return_assumption = EXCLUDED.return_assumption,
                      amount_in_today_brl = EXCLUDED.amount_in_today_brl
        RETURNING id::TEXT AS id, (xmax = 0) AS created
      `;

      if (row === undefined) {
        return failure(getRepositoryError(new Error('gravação do objetivo sem retorno')));
      }

      const saved: GoalSaved = {
        ...write,
        id: asString(row, 'id'),
        created: asBoolean(row, 'created'),
      };

      return success(saved);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  remove: async (portfolioId: string) => {
    try {
      const rows = await sql<Row[]>`
        DELETE FROM goal
         WHERE portfolio_id = ${portfolioId}::UUID
           AND closed_at IS NULL
        RETURNING id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
