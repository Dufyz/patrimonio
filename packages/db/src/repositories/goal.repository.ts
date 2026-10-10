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
        with goal_rows as (
          select g.id,
                 g.name,
                 g.target_amount,
                 g.target_date,
                 g.return_assumption,
                 g.amount_in_today_brl,
                 g.created_at::date as created_on,
                 exists (
                   select 1 from goal_portfolio link where link.goal_id = g.id
                 ) as linked
            from goal g
           where g.closed_at is null
        ),
        -- Quem mede cada objetivo: as carteiras ligadas, ou todas as abertas
        -- quando ele não aponta nenhuma.
        measured as (
          select r.id as goal_id, p.id as portfolio_id, p.name
            from goal_rows r
            join portfolio p on p.archived_at is null
           where not r.linked
              or exists (
                   select 1
                     from goal_portfolio link
                    where link.goal_id = r.id
                      and link.portfolio_id = p.id
                 )
        ),
        scoped as (
          select r.*
            from goal_rows r
           where ${query.portfolio_id}::uuid is null
              or exists (
                   select 1
                     from measured m
                    where m.goal_id = r.id
                      and m.portfolio_id = ${query.portfolio_id}::uuid
                 )
        ),
        latest as (
          select m.goal_id, m.portfolio_id, m.name, d.position_date, d.total_value
            from measured m
            join scoped r on r.id = m.goal_id
            left join lateral (
              select day.position_date, day.total_value
                from portfolio_daily day
               where day.portfolio_id = m.portfolio_id
                 and day.position_date <= ${query.on_date}::date
               order by day.position_date desc
               limit 1
            ) d on true
        ),
        firsts as (
          select m.goal_id, min(first_close.position_date) as first_date
            from measured m
            join scoped r on r.id = m.goal_id
           cross join lateral (
              select day.position_date
                from portfolio_daily day
               where day.portfolio_id = m.portfolio_id
                 and day.position_date <= ${query.on_date}::date
               order by day.position_date asc
               limit 1
            ) first_close
           group by m.goal_id
        ),
        starts as (
          select r.id as goal_id,
                 greatest(least(r.created_on, ${query.on_date}::date), f.first_date)
                   as start_date
            from scoped r
            join firsts f on f.goal_id = r.id
        ),
        start_values as (
          select s.goal_id,
                 s.start_date,
                 coalesce(sum(v.total_value), 0) as start_value
            from starts s
            join measured m on m.goal_id = s.goal_id
            left join lateral (
              select day.total_value
                from portfolio_daily day
               where day.portfolio_id = m.portfolio_id
                 and day.position_date <= s.start_date
               order by day.position_date desc
               limit 1
            ) v on true
           group by s.goal_id, s.start_date
        ),
        -- Mês sem fluxo não entra: o caso de uso o conta como zero na média.
        flows as (
          select m.goal_id,
                 to_char(day.position_date, 'YYYY-MM') as month,
                 sum(day.net_flow) as net_flow
            from measured m
            join scoped r on r.id = m.goal_id
            join portfolio_daily day on day.portfolio_id = m.portfolio_id
           where day.position_date >=
                   (date_trunc('month', ${query.on_date}::date) - interval '12 months')::date
             and day.position_date <= ${query.on_date}::date
           group by m.goal_id, to_char(day.position_date, 'YYYY-MM')
          having sum(day.net_flow) <> 0
        )
        select (
                 select jsonb_build_object('portfolio_id', p.id::text, 'name', p.name)
                   from portfolio p
                  where p.id = ${query.portfolio_id}::uuid
                    and p.archived_at is null
               ) as scope_portfolio,
               coalesce((
                 select jsonb_agg(
                          jsonb_build_object(
                            'goal_id', r.id::text,
                            'name', r.name,
                            'target_amount', r.target_amount::text,
                            'target_date', to_char(r.target_date, 'YYYY-MM-DD'),
                            'return_assumption', r.return_assumption,
                            'amount_in_today_brl', r.amount_in_today_brl,
                            'created_on', to_char(r.created_on, 'YYYY-MM-DD'),
                            'linked', r.linked,
                            'portfolios', coalesce((
                              select jsonb_agg(
                                       jsonb_build_object(
                                         'portfolio_id', l.portfolio_id::text,
                                         'name', l.name,
                                         'value', l.total_value::text
                                       )
                                       order by l.name
                                     )
                                from latest l
                               where l.goal_id = r.id
                            ), '[]'::jsonb),
                            'current_value', coalesce((
                              select sum(l.total_value) from latest l where l.goal_id = r.id
                            ), 0)::text,
                            'as_of', (
                              select to_char(max(l.position_date), 'YYYY-MM-DD')
                                from latest l
                               where l.goal_id = r.id
                            ),
                            'history_start', (
                              select to_char(f.first_date, 'YYYY-MM-DD')
                                from firsts f
                               where f.goal_id = r.id
                            ),
                            'start_date', (
                              select to_char(sv.start_date, 'YYYY-MM-DD')
                                from start_values sv
                               where sv.goal_id = r.id
                            ),
                            'start_value', (
                              select sv.start_value::text
                                from start_values sv
                               where sv.goal_id = r.id
                            ),
                            'flows', coalesce((
                              select jsonb_agg(
                                       jsonb_build_object(
                                         'month', fl.month,
                                         'net_flow', fl.net_flow::text
                                       )
                                       order by fl.month
                                     )
                                from flows fl
                               where fl.goal_id = r.id
                            ), '[]'::jsonb)
                          )
                          order by r.target_date, lower(r.name)
                        )
                   from scoped r
               ), '[]'::jsonb) as goals,
               (
                 select jsonb_build_object(
                          'factor', exp(sum(ln(q.daily_factor)))::text,
                          'first_date', to_char(min(q.quote_date), 'YYYY-MM-DD'),
                          'last_date', to_char(max(q.quote_date), 'YYYY-MM-DD')
                        )
                   from index_quote q
                  where q.index_code = 'IPCA'
                    and q.quote_date > (${query.on_date}::date - interval '12 months')::date
                    and q.quote_date <= ${query.on_date}::date
               ) as inflation
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
