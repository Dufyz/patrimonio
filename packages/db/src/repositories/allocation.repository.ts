import type {
  AllocationCategoryRow,
  AllocationPortfolioRow,
  AllocationQuery,
  AllocationRepository,
  AllocationSnapshot,
  AllocationTargetRow,
} from '@patrimonio/application';
import {
  asDateOnlyOrNull,
  asEnum,
  asInteger,
  asIntegerOrNull,
  asNumeric,
  asNumericOrNull,
  asString,
  asStringOrNull,
  REBALANCE_MODES,
  RECALC_STATUSES,
} from '@patrimonio/domain';
import type { Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * A tela de Estratégia em **uma** consulta: a carteira com as regras, o cadastro
 * de categorias com o valor de cada uma, e o alvo declarado — todos sobre o mesmo
 * fechamento.
 *
 * Três decisões dentro dela que não são óbvias:
 *
 * - **O cadastro inteiro entra, com ou sem posição.** Declarar alvo para uma
 *   categoria vazia é exatamente o que a primeira estratégia faz; ler só o que
 *   está em carteira a deixaria sem as linhas que ela precisa preencher.
 * - **Ativo direto num grupo vira a linha "Outros" do grupo.** O banco permite
 *   classificar um ativo num grupo, não só numa categoria; sem a linha, o grupo
 *   deixaria de ser a soma das categorias dentro dele, e o subtotal da tela
 *   divergiria do valor do grupo. O id da linha é o do próprio grupo, que é uma
 *   categoria como outra qualquer para o alvo.
 * - **Ativo sem categoria aparece como "Sem categoria"**, sem alvo possível:
 *   ele é patrimônio, e escondê-lo inflaria o peso de todo o resto.
 */
const SEM_CATEGORIA = 'sem-categoria';

/** Depois de qualquer categoria do cadastro: ordem de exibição, não de valor. */
const AFTER_CATALOG = 1_000_000;

const parsePortfolio = (row: Row): AllocationPortfolioRow => ({
  portfolio_id: asString(row, 'portfolio_id'),
  name: asString(row, 'name'),
  purpose: asStringOrNull(row, 'purpose'),
  recalc_status: asEnum(row, 'recalc_status', RECALC_STATUSES),
  tolerance_pp: asNumeric(row, 'tolerance_pp'),
  max_asset_weight_pct: asNumericOrNull(row, 'max_asset_weight_pct'),
  rebalance_mode: asEnum(row, 'rebalance_mode', REBALANCE_MODES),
  review_every_months: asIntegerOrNull(row, 'review_every_months'),
  benchmark_id: asStringOrNull(row, 'benchmark_id'),
  benchmark_name: asStringOrNull(row, 'benchmark_name'),
  reviewed_on: asDateOnlyOrNull(row, 'reviewed_on'),
  next_review_on: asDateOnlyOrNull(row, 'next_review_on'),
  total_value: asNumericOrNull(row, 'total_value'),
});

const parseCategory = (row: Row): AllocationCategoryRow => ({
  category_id: asString(row, 'category_id'),
  category_name: asString(row, 'category_name'),
  group_id: asStringOrNull(row, 'group_id'),
  group_name: asStringOrNull(row, 'group_name'),
  group_sort_order: asIntegerOrNull(row, 'group_sort_order'),
  color_token: asString(row, 'color_token'),
  sort_order: asInteger(row, 'sort_order'),
  value: asNumeric(row, 'value'),
});

const parseTarget = (row: Row): AllocationTargetRow => ({
  category_id: asString(row, 'category_id'),
  target_pct: asNumeric(row, 'target_pct'),
});

const asRows = (value: unknown): readonly Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];

export const createAllocationRepository = (sql: Connection): AllocationRepository => ({
  snapshot: async (query: AllocationQuery) => {
    try {
      const [row] = await sql<Row[]>`
        with reference as (
          select max(position_date) as position_date
            from portfolio_daily
           where portfolio_id = ${query.portfolio_id}::uuid
             and position_date <= ${query.on_date}::date
        ),
        portfolio_row as (
          select p.id::text as portfolio_id,
                 p.name,
                 p.purpose,
                 p.recalc_status,
                 p.tolerance_pp::text as tolerance_pp,
                 p.max_asset_weight_pct::text as max_asset_weight_pct,
                 p.rebalance_mode,
                 p.review_every_months,
                 p.benchmark_id::text as benchmark_id,
                 benchmark.name as benchmark_name,
                 (select max(target.updated_at)::date
                    from strategy_target target
                   where target.portfolio_id = p.id) as reviewed_on,
                 (select (max(target.updated_at)::date
                          + make_interval(months => p.review_every_months::int))::date
                    from strategy_target target
                   where target.portfolio_id = p.id) as next_review_on,
                 (select day.total_value::text
                    from portfolio_daily day
                   where day.portfolio_id = p.id
                     and day.position_date <= ${query.on_date}::date
                   order by day.position_date desc
                   limit 1) as total_value
            from portfolio p
            left join benchmark on benchmark.id = p.benchmark_id
           where p.id = ${query.portfolio_id}::uuid
             and p.archived_at is null
        ),
        -- A carteira na última data que ela tem até a referência: recálculo
        -- atrasado não pode esvaziar a tela.
        last_position as (
          select max(position_date) as position_date
            from position_daily
           where portfolio_id = ${query.portfolio_id}::uuid
             and position_date <= (select position_date from reference)
        ),
        held as (
          select pos.asset_id, pos.market_value
            from position_daily pos
           where pos.portfolio_id = ${query.portfolio_id}::uuid
             and pos.position_date = (select position_date from last_position)
             and pos.quantity <> 0
        ),
        category_values as (
          select asset.category_id, sum(held.market_value) as value
            from held
            join asset on asset.id = held.asset_id
           group by asset.category_id
        ),
        catalog as (
          select c.id,
                 c.name,
                 c.parent_id,
                 c.color_token,
                 c.sort_order,
                 exists (
                   select 1 from category child where child.parent_id = c.id
                 ) as is_group
            from category c
        ),
        lines as (
          select c.id::text as category_id,
                 c.name as category_name,
                 parent.id::text as group_id,
                 parent.name as group_name,
                 parent.sort_order as group_sort_order,
                 c.color_token,
                 c.sort_order,
                 coalesce(v.value, 0)::text as value
            from catalog c
            left join catalog parent on parent.id = c.parent_id
            left join category_values v on v.category_id = c.id
           where not c.is_group

          union all

          select c.id::text,
                 'Outros',
                 c.id::text,
                 c.name,
                 c.sort_order,
                 c.color_token,
                 ${AFTER_CATALOG}::int,
                 v.value::text
            from catalog c
            join category_values v on v.category_id = c.id
           where c.is_group and v.value <> 0

          union all

          select ${SEM_CATEGORIA},
                 'Sem categoria',
                 null,
                 null,
                 null,
                 'class.outros',
                 ${AFTER_CATALOG}::int,
                 v.value::text
            from category_values v
           where v.category_id is null and v.value <> 0
        )
        select (select position_date from reference) as reference_date,
               (select to_jsonb(portfolio_row) from portfolio_row) as portfolio,
               coalesce((
                 select jsonb_agg(
                          to_jsonb(lines)
                          order by lines.group_sort_order nulls last,
                                   lines.sort_order,
                                   lines.category_name
                        )
                   from lines
               ), '[]'::jsonb) as categories,
               coalesce((
                 select jsonb_agg(
                          jsonb_build_object(
                            'category_id', target.category_id::text,
                            'target_pct', target.target_pct::text
                          )
                        )
                   from strategy_target target
                  where target.portfolio_id = ${query.portfolio_id}::uuid
               ), '[]'::jsonb) as targets
      `;

      if (row === undefined) {
        return failure(
          getRepositoryError(new Error('a consulta da estratégia não devolveu linha')),
        );
      }

      const portfolio = row['portfolio'];

      const snapshot: AllocationSnapshot = {
        reference_date: asDateOnlyOrNull(row, 'reference_date'),
        portfolio:
          portfolio === null || portfolio === undefined
            ? null
            : parsePortfolio(portfolio as Row),
        categories: asRows(row['categories']).map(parseCategory),
        targets: asRows(row['targets']).map(parseTarget),
      };

      return success(snapshot);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
