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
                 sum(cumulative_contributions)::text as cumulative_contributions,
                 case
                   when ${scope}::uuid is null then null
                   else min(quota_value)::text
                 end as quota_value
            from portfolio_daily
           where portfolio_id in (select id from scope)
             and position_date between ${query.from}::date and ${query.to}::date
           group by position_date
        ),
        anchor_date as (
          select 'previous_day' as kind,
                 (select max(position_date)
                    from portfolio_daily
                   where portfolio_id in (select id from scope)
                     and position_date < (select position_date from reference)
                 ) as position_date
          union all
          select 'month_base',
                 (select max(position_date)
                    from portfolio_daily
                   where portfolio_id in (select id from scope)
                     and position_date
                         < date_trunc('month', (select position_date from reference))::date
                 )
          union all
          select 'window_base',
                 (select max(position_date)
                    from portfolio_daily
                   where portfolio_id in (select id from scope)
                     and position_date < ${query.from}::date
                 )
        ),
        anchors as (
          select a.kind,
                 day.position_date,
                 sum(day.total_value)::text as total_value,
                 sum(day.net_flow)::text as net_flow,
                 sum(day.income)::text as income,
                 sum(day.payouts)::text as payouts,
                 sum(day.cumulative_contributions)::text as cumulative_contributions,
                 case
                   when ${scope}::uuid is null then null
                   else min(day.quota_value)::text
                 end as quota_value
            from anchor_date a
            join portfolio_daily day
              on day.position_date = a.position_date
             and day.portfolio_id in (select id from scope)
           group by a.kind, day.position_date
        ),
        portfolios as (
          select p.id::text as portfolio_id,
                 p.name,
                 p.purpose,
                 p.tolerance_pp::text as tolerance_pp,
                 p.recalc_status,
                 (select day.total_value::text
                    from portfolio_daily day
                   where day.portfolio_id = p.id
                     and day.position_date <= ${query.on_date}::date
                   order by day.position_date desc
                   limit 1) as total_value,
                 p.sort_order
            from portfolio p
           where p.archived_at is null
        ),
        -- Cada carteira na última data que ela tem até a referência: recálculo
        -- atrasado em uma carteira não pode sumir com ela do consolidado.
        last_position_date as (
          select held.portfolio_id, max(held.position_date) as position_date
            from position_daily held
            join scope s on s.id = held.portfolio_id
           where held.position_date <= (select position_date from reference)
           group by held.portfolio_id
        ),
        held as (
          select pos.*
            from position_daily pos
            join last_position_date latest
              on latest.portfolio_id = pos.portfolio_id
             and latest.position_date = pos.position_date
        ),
        positions as (
          select held.asset_id::text as asset_id,
                 asset.ticker,
                 asset.name,
                 category.color_token,
                 sum(held.market_value)::text as value,
                 -- O pior estado entre as carteiras: um papel sem preço em uma
                 -- delas é um papel sem preço na tela.
                 min(
                   case held.price_source_kind
                     when 'missing' then 1
                     when 'stale' then 2
                     when 'manual' then 3
                     else 4
                   end
                 ) as health
            from held
            join asset on asset.id = held.asset_id
            left join category on category.id = asset.category_id
           group by held.asset_id, asset.ticker, asset.name, category.color_token
          having sum(held.quantity) <> 0
        ),
        categories as (
          select coalesce(category.id::text, ${SEM_CATEGORIA}) as category_id,
                 coalesce(category.name, 'Sem categoria') as category_name,
                 parent.id::text as group_id,
                 parent.name as group_name,
                 coalesce(category.color_token, 'class.outros') as color_token,
                 sum(held.market_value)::text as value
            from held
            join asset on asset.id = held.asset_id
            left join category on category.id = asset.category_id
            left join category parent on parent.id = category.parent_id
           group by category.id, category.name, parent.id, parent.name,
                    category.color_token
          having sum(held.quantity) <> 0
        ),
        targets as (
          select target.category_id::text as category_id,
                 target.target_pct::text as target_pct
            from strategy_target target
           where ${scope}::uuid is not null
             and target.portfolio_id = ${scope}::uuid
        )
        select (select position_date from reference) as reference_date,
               (select position_date from inception) as inception,
               coalesce((
                 select jsonb_agg(to_jsonb(series) order by series.position_date)
                   from series
               ), '[]'::jsonb) as days,
               coalesce((
                 select jsonb_agg(to_jsonb(anchors)) from anchors
               ), '[]'::jsonb) as anchors,
               coalesce((
                 select jsonb_agg(
                          to_jsonb(portfolios) - 'sort_order'
                          order by portfolios.sort_order, portfolios.name
                        )
                   from portfolios
               ), '[]'::jsonb) as portfolios,
               coalesce((
                 select jsonb_agg(
                          to_jsonb(positions) - 'health'
                          || jsonb_build_object(
                               'price_source_kind',
                               case positions.health
                                 when 1 then 'missing'
                                 when 2 then 'stale'
                                 when 3 then 'manual'
                                 else 'fresh'
                               end
                             )
                          order by positions.value::numeric desc
                        )
                   from positions
               ), '[]'::jsonb) as positions,
               coalesce((
                 select jsonb_agg(to_jsonb(categories) order by categories.value::numeric desc)
                   from categories
               ), '[]'::jsonb) as categories,
               coalesce((
                 select jsonb_agg(to_jsonb(targets)) from targets
               ), '[]'::jsonb) as targets
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
