import type {
  PerformanceBenchmarkRow,
  PerformanceBreakdown,
  PerformanceBreakdownQuery,
  PerformanceCategoryRow,
  PerformanceClassFlow,
  PerformanceClassValue,
  PerformanceDayRow,
  PerformancePortfolioPoint,
  PerformanceSnapshotPortfolio,
  PerformanceRepository,
  PerformanceSnapshot,
  PerformanceSnapshotQuery,
} from '@patrimonio/application';
import {
  asBoolean,
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
 * A primeira devolve a história do escopo e o catálogo de benchmarks. Com ela o
 * caso de uso descobre o último fechamento, o primeiro, as datas-base de cada
 * janela e os índices de que os benchmarks escolhidos dependem — e só então
 * pode pedir à segunda o que depende deles.
 *
 * Duas decisões dentro delas que não são óbvias:
 *
 * - **A série vem inteira, não só o período do gráfico.** A grade mês por ano
 *   mostra todos os anos desde o início, e o consolidado não tem cota gravada:
 *   para construí-la é preciso partir do primeiro dia. Dez anos são cerca de
 *   2.500 linhas de seis colunas, que é o que o banco devolve sem esforço — e é
 *   mais barato que reabrir a conexão para pedir o que faltou.
 * - **O início de cada carteira é o primeiro fechamento dela.** Uma carteira que
 *   abriu depois das outras não tem retorno "desde o início do escopo": o início
 *   dela é o dia em que ela abriu, e a coluna Início da tabela por carteira
 *   mede a carteira, não o escopo.
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
  portfolio_id: asString(row, 'portfolio_id'),
  name: asString(row, 'name'),
  purpose: asStringOrNull(row, 'purpose'),
  recalc_status: asEnum(row, 'recalc_status', RECALC_STATUSES),
  benchmark_id: asStringOrNull(row, 'benchmark_id'),
  total_value: row['total_value'] === null ? null : asNumeric(row, 'total_value'),
});

const parseBenchmark = (row: Row): PerformanceBenchmarkRow => ({
  id: asString(row, 'id'),
  name: asString(row, 'name'),
  kind: asString(row, 'kind'),
  rebalance: asString(row, 'rebalance'),
  definition: row['definition'],
});

const parsePortfolioPoint = (row: Row): PerformancePortfolioPoint => ({
  portfolio_id: asString(row, 'portfolio_id'),
  label: asString(row, 'label'),
  position_date: asDateOnlyOrNull(row, 'position_date'),
  quota_value: row['quota_value'] === null ? null : asNumeric(row, 'quota_value'),
});

const parseCategory = (row: Row): PerformanceCategoryRow => ({
  category_id: asString(row, 'category_id'),
  name: asString(row, 'name'),
  color_token: asString(row, 'color_token'),
  is_cash: asBoolean(row, 'is_cash'),
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
        with scope as (
          select p.id
            from portfolio p
           where p.archived_at is null
             and (${scope}::uuid is null or p.id = ${scope}::uuid)
        ),
        reference as (
          select max(position_date) as position_date
            from portfolio_daily
           where portfolio_id in (select id from scope)
             and position_date <= ${query.on_date}::date
        ),
        inception as (
          select min(position_date) as position_date
            from portfolio_daily
           where portfolio_id in (select id from scope)
        ),
        series as (
          select position_date,
                 sum(total_value)::text as total_value,
                 sum(net_flow)::text as net_flow,
                 sum(income)::text as income,
                 sum(payouts)::text as payouts,
                 case
                   when ${scope}::uuid is null then null
                   else min(quota_value)::text
                 end as quota_value
            from portfolio_daily
           where portfolio_id in (select id from scope)
             and position_date <= (select position_date from reference)
           group by position_date
        ),
        portfolios as (
          select p.id::text as portfolio_id,
                 p.name,
                 p.purpose,
                 p.recalc_status,
                 p.benchmark_id::text as benchmark_id,
                 -- Cada carteira no último fechamento que ela tem até a
                 -- referência: recálculo atrasado não pode tirá-la da tabela.
                 (select day.total_value::text
                    from portfolio_daily day
                   where day.portfolio_id = p.id
                     and day.position_date <= (select position_date from reference)
                   order by day.position_date desc
                   limit 1) as total_value,
                 p.sort_order
            from portfolio p
           where p.archived_at is null
        ),
        catalog as (
          select b.id::text as id,
                 b.name,
                 b.kind::text as kind,
                 b.rebalance::text as rebalance,
                 b.definition
            from benchmark b
        )
        select (select position_date from reference) as reference_date,
               (select position_date from inception) as inception,
               coalesce((
                 select jsonb_agg(to_jsonb(series) order by series.position_date)
                   from series
               ), '[]'::jsonb) as days,
               coalesce((
                 select jsonb_agg(
                          to_jsonb(portfolios) - 'sort_order'
                          order by portfolios.sort_order, portfolios.name
                        )
                   from portfolios
               ), '[]'::jsonb) as portfolios,
               coalesce((
                 select jsonb_agg(to_jsonb(catalog) order by lower(catalog.name))
                   from catalog
               ), '[]'::jsonb) as benchmarks
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
        portfolios: asRows(row['portfolios']).map(parsePortfolio),
        benchmarks: asRows(row['benchmarks']).map(parseBenchmark),
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
        with scope as (
          select p.id
            from portfolio p
           where p.archived_at is null
             and (${scope}::uuid is null or p.id = ${scope}::uuid)
        ),
        points as (
          select t.label, t.point_date
            from unnest(${labels}::text[], ${dates}::date[]) as t(label, point_date)
        ),
        -- A cota de cada carteira em cada ponto: a última em ou antes da data,
        -- e para o início, a primeira que a carteira tem. Sem linha, a carteira
        -- ainda não existia, e o retorno daquela janela é traço.
        portfolio_points as (
          select p.id::text as portfolio_id,
                 pt.label,
                 d.position_date,
                 d.quota_value::text as quota_value
            from portfolio p
           cross join points pt
            left join lateral (
              select day.position_date, day.quota_value
                from portfolio_daily day
               where day.portfolio_id = p.id
                 and (pt.label = 'inception' or day.position_date <= pt.point_date)
               order by (case when pt.label = 'inception' then day.position_date end) asc nulls last,
                        day.position_date desc
               limit 1
            ) d on true
           where p.archived_at is null
        ),
        -- O valor de cada classe em cada ponto, cada carteira na última data
        -- que ela tem até ele.
        class_values as (
          select pt.label,
                 coalesce(c.id::text, ${SEM_CATEGORIA}) as category_id,
                 sum(pos.market_value)::text as value
            from points pt
           cross join scope s
            join lateral (
              select max(day.position_date) as position_date
                from portfolio_daily day
               where day.portfolio_id = s.id
                 and day.position_date <= pt.point_date
            ) last on last.position_date is not null
            join position_daily pos
              on pos.portfolio_id = s.id
             and pos.position_date = last.position_date
            join asset a on a.id = pos.asset_id
            left join category c on c.id = a.category_id
           group by pt.label, c.id
        ),
        -- O que entrou na classe e o que ela pagou, por dia. Compra e venda
        -- movem a classe com o sinal contrário ao do caixa; a perna de uma
        -- transferência entra com o próprio sinal; a amortização devolve
        -- principal e sai como fluxo, não como rendimento. Caixa fica de fora:
        -- ele não rende por si.
        flows as (
          select coalesce(c.id::text, ${SEM_CATEGORIA}) as category_id,
                 t.trade_date,
                 sum(
                   case t.kind
                     when 'buy' then -t.net_amount
                     when 'sell' then -t.net_amount
                     when 'transfer' then t.net_amount
                     when 'payout' then
                       case when t.payout_kind = 'amortization' then -t.net_amount else 0 end
                     else 0
                   end
                 )::numeric(20,2)::text as flow,
                 sum(
                   case
                     when t.kind = 'payout' and t.payout_kind is distinct from 'amortization'
                       then t.net_amount
                     else 0
                   end
                 )::numeric(20,2)::text as income
            from transaction t
            join asset a on a.id = t.asset_id
            left join category c on c.id = a.category_id
           where t.portfolio_id in (select id from scope)
             and t.trade_date > ${query.flows_from}::date
             and t.trade_date <= ${query.reference}::date
             and a.b3_type is distinct from 'cash'
             and (t.kind <> 'payout' or t.confirmed_at is not null)
           group by c.id, t.trade_date
        ),
        used as (
          select category_id from class_values
          union
          select category_id from flows
        ),
        categories as (
          select coalesce(c.id::text, ${SEM_CATEGORIA}) as category_id,
                 coalesce(c.name, 'Sem categoria') as name,
                 coalesce(c.color_token, 'class.outros') as color_token,
                 coalesce(bool_or(a.b3_type = 'cash'), false) as is_cash
            from asset a
            left join category c on c.id = a.category_id
           group by c.id, c.name, c.color_token
          having coalesce(c.id::text, ${SEM_CATEGORIA}) in (select category_id from used)
        ),
        factors as (
          select q.index_code, q.quote_date, q.daily_factor::text as daily_factor
            from index_quote q
           where q.index_code = any(${query.index_codes}::text[])
             and q.quote_date > ${query.factors_from}::date
             and q.quote_date <= ${query.reference}::date
        )
        select coalesce((
                 select jsonb_object_agg(by_code.index_code, by_code.by_date)
                   from (
                     select f.index_code,
                            jsonb_object_agg(f.quote_date::text, f.daily_factor) as by_date
                       from factors f
                      group by f.index_code
                   ) by_code
               ), '{}'::jsonb) as factors,
               coalesce((select jsonb_agg(to_jsonb(portfolio_points)) from portfolio_points),
                        '[]'::jsonb) as portfolio_points,
               coalesce((select jsonb_agg(to_jsonb(categories)) from categories),
                        '[]'::jsonb) as categories,
               coalesce((select jsonb_agg(to_jsonb(class_values)) from class_values),
                        '[]'::jsonb) as class_values,
               coalesce((select jsonb_agg(to_jsonb(flows)) from flows),
                        '[]'::jsonb) as class_flows
      `;

      if (row === undefined) {
        return failure(
          getRepositoryError(new Error('a consulta de desempenho não devolveu linha')),
        );
      }

      const breakdown: PerformanceBreakdown = {
        factors: parseFactors(row['factors']),
        portfolio_points: asRows(row['portfolio_points']).map(parsePortfolioPoint),
        categories: asRows(row['categories']).map(parseCategory),
        class_values: asRows(row['class_values']).map(parseClassValue),
        class_flows: asRows(row['class_flows']).map(parseClassFlow),
      };

      return success(breakdown);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
