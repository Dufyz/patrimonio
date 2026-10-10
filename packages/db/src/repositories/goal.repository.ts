import type {
  GoalFlowRow,
  GoalInflationRow,
  GoalPortfolioRow,
  GoalRepository,
  GoalRow,
  GoalSnapshot,
  GoalSnapshotQuery,
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

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * A tela de Objetivos em **uma** consulta: os objetivos abertos, as carteiras
 * que cada um mede, o valor delas hoje e no começo, o fluxo mensal recente e o
 * IPCA dos últimos doze meses — tudo sobre a mesma data de referência.
 *
 * Quatro decisões dentro dela que não são óbvias:
 *
 * - **Objetivo sem carteira ligada mede o patrimônio todo.** `measured` o junta
 *   a toda carteira aberta, e é isso que continua certo quando uma carteira
 *   nova é criada: ligar "todas" uma a uma a deixaria de fora sem ninguém ter
 *   decidido isso.
 * - **Cada carteira lê o seu último fechamento.** Uma carteira com recálculo
 *   atrasado não pode sumir do total: ela entra com o valor que tem, e `as_of`
 *   diz até onde vai o dado mais recente.
 * - **O começo do objetivo é o dia em que ele foi criado, ou o primeiro
 *   fechamento, se a história veio depois.** Medir o "esperado hoje" a partir de
 *   uma data sem valor seria partir de zero e declarar um atraso que não houve.
 * - **O filtro de carteira escolhe objetivos, não os mede.** Com uma carteira
 *   selecionada entram os objetivos que a contam; o progresso de cada um
 *   continua sendo o das carteiras **dele**, e não o da carteira do filtro.
 */
const asRows = (value: unknown): readonly Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

const parsePortfolio = (row: Row): GoalPortfolioRow => ({
  portfolio_id: asString(row, 'portfolio_id'),
  name: asString(row, 'name'),
  value: asNumericOrNull(row, 'value'),
});

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
  linked: asBoolean(row, 'linked'),
  portfolios: asRows(row['portfolios']).map(parsePortfolio),
  current_value: asNumeric(row, 'current_value'),
  as_of: asDateOnlyOrNull(row, 'as_of'),
  history_start: asDateOnlyOrNull(row, 'history_start'),
  start_date: asDateOnlyOrNull(row, 'start_date'),
  start_value: asNumericOrNull(row, 'start_value'),
  flows: asRows(row['flows']).map(parseFlow),
});

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
    try {
      const [row] = await sql<Row[]>`
        WITH goal_rows AS (
          SELECT g.id,
                 g.name,
                 g.target_amount,
                 g.target_date,
                 g.return_assumption,
                 g.amount_in_today_brl,
                 g.created_at::DATE AS created_on,
                 EXISTS (
                   SELECT 1 FROM goal_portfolio link WHERE link.goal_id = g.id
                 ) AS linked
            FROM goal g
           WHERE g.closed_at IS NULL
        ),
        -- Quem mede cada objetivo: as carteiras ligadas, ou todas as abertas
        -- quando ele não aponta nenhuma.
        measured AS (
          SELECT r.id AS goal_id, p.id AS portfolio_id, p.name
            FROM goal_rows r
            JOIN portfolio p ON p.archived_at IS NULL
           WHERE NOT r.linked
              OR EXISTS (
                   SELECT 1
                     FROM goal_portfolio link
                    WHERE link.goal_id = r.id
                      AND link.portfolio_id = p.id
                 )
        ),
        scoped AS (
          SELECT r.*
            FROM goal_rows r
           WHERE ${query.portfolio_id}::UUID IS NULL
              OR EXISTS (
                   SELECT 1
                     FROM measured m
                    WHERE m.goal_id = r.id
                      AND m.portfolio_id = ${query.portfolio_id}::UUID
                 )
        ),
        latest AS (
          SELECT m.goal_id, m.portfolio_id, m.name, d.position_date, d.total_value
            FROM measured m
            JOIN scoped r ON r.id = m.goal_id
            LEFT JOIN LATERAL (
              SELECT day.position_date, day.total_value
                FROM portfolio_daily day
               WHERE day.portfolio_id = m.portfolio_id
                 AND day.position_date <= ${query.on_date}::DATE
               ORDER BY day.position_date DESC
               LIMIT 1
            ) d ON TRUE
        ),
        firsts AS (
          SELECT m.goal_id, MIN(first_close.position_date) AS first_date
            FROM measured m
            JOIN scoped r ON r.id = m.goal_id
           CROSS JOIN LATERAL (
              SELECT day.position_date
                FROM portfolio_daily day
               WHERE day.portfolio_id = m.portfolio_id
                 AND day.position_date <= ${query.on_date}::DATE
               ORDER BY day.position_date ASC
               LIMIT 1
            ) first_close
           GROUP BY m.goal_id
        ),
        starts AS (
          SELECT r.id AS goal_id,
                 GREATEST(LEAST(r.created_on, ${query.on_date}::DATE), f.first_date)
                   AS start_date
            FROM scoped r
            JOIN firsts f ON f.goal_id = r.id
        ),
        start_values AS (
          SELECT s.goal_id,
                 s.start_date,
                 COALESCE(SUM(v.total_value), 0) AS start_value
            FROM starts s
            JOIN measured m ON m.goal_id = s.goal_id
            LEFT JOIN LATERAL (
              SELECT day.total_value
                FROM portfolio_daily day
               WHERE day.portfolio_id = m.portfolio_id
                 AND day.position_date <= s.start_date
               ORDER BY day.position_date DESC
               LIMIT 1
            ) v ON TRUE
           GROUP BY s.goal_id, s.start_date
        ),
        -- Mês sem fluxo não entra: o caso de uso o conta como zero na média.
        flows AS (
          SELECT m.goal_id,
                 TO_CHAR(day.position_date, 'YYYY-MM') AS month,
                 SUM(day.net_flow) AS net_flow
            FROM measured m
            JOIN scoped r ON r.id = m.goal_id
            JOIN portfolio_daily day ON day.portfolio_id = m.portfolio_id
           WHERE day.position_date >=
                   (DATE_TRUNC('month', ${query.on_date}::DATE) - INTERVAL '12 months')::DATE
             AND day.position_date <= ${query.on_date}::DATE
           GROUP BY m.goal_id, TO_CHAR(day.position_date, 'YYYY-MM')
          HAVING SUM(day.net_flow) <> 0
        )
        SELECT (
                 SELECT JSONB_BUILD_OBJECT('portfolio_id', p.id::TEXT, 'name', p.name)
                   FROM portfolio p
                  WHERE p.id = ${query.portfolio_id}::UUID
                    AND p.archived_at IS NULL
               ) AS scope_portfolio,
               COALESCE((
                 SELECT JSONB_AGG(
                          JSONB_BUILD_OBJECT(
                            'goal_id', r.id::TEXT,
                            'name', r.name,
                            'target_amount', r.target_amount::TEXT,
                            'target_date', TO_CHAR(r.target_date, 'YYYY-MM-DD'),
                            'return_assumption', r.return_assumption,
                            'amount_in_today_brl', r.amount_in_today_brl,
                            'created_on', TO_CHAR(r.created_on, 'YYYY-MM-DD'),
                            'linked', r.linked,
                            'portfolios', COALESCE((
                              SELECT JSONB_AGG(
                                       JSONB_BUILD_OBJECT(
                                         'portfolio_id', l.portfolio_id::TEXT,
                                         'name', l.name,
                                         'value', l.total_value::TEXT
                                       )
                                       ORDER BY l.name
                                     )
                                FROM latest l
                               WHERE l.goal_id = r.id
                            ), '[]'::JSONB),
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
                          ORDER BY r.target_date, LOWER(r.name)
                        )
                   FROM scoped r
               ), '[]'::JSONB) AS goals,
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
        goals: asRows(row['goals']).map(parseGoal),
        inflation: parseInflation(row['inflation']),
      };

      return success(snapshot);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
