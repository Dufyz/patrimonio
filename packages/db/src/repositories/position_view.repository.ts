import type {
  PositionView,
  PositionViewFacetRow,
  PositionViewFilter,
  PositionViewHeader,
  PositionViewRepository,
  PositionViewRow,
  PositionViewSummaryRow,
} from '@patrimonio/application';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * T-02 · A tela de Posições em duas consultas.
 *
 * Uma traz as linhas, a outra traz tudo que é soma: subtotal por grupo, total
 * geral, contagem de cada pastilha e o cabeçalho. Duas e não dez porque o banco
 * fica em outra rede, e porque o orçamento de consultas por rota (T-11) é
 * verificado por teste.
 *
 * Toda a aritmética é `numeric` do Postgres e sai daqui como `text`. Nem este
 * arquivo nem a tela somam dinheiro em JavaScript: `numeric(20,2)` não cabe em
 * `double`, e um centavo perdido no caminho reaparece como subtotal que não
 * fecha com a soma das linhas.
 *
 * Duas medidas que parecem iguais e não são:
 *
 * - **variação do dia e retorno de 12 meses de uma linha** saem do valor
 *   unitário (`market_value / quantity`), que aporte e resgate não contaminam —
 *   comprar mais do mesmo papel muda a quantidade, não o preço;
 * - **as mesmas medidas de um grupo** não existem: a média ponderada das
 *   variações só valeria sem fluxo no período. O retorno de um conjunto sai da
 *   série de cota, que é por carteira (C-07), e é por isso que o cabeçalho os
 *   traz e o subtotal de grupo não.
 */

/** A escala das razões: seis casas bastam para um percentual com duas. */
const RATIO_SCALE = 6;

/**
 * A escala do valor unitário. `market_value / quantity` é divisão de `numeric`,
 * e o Postgres devolve a ela a escala máxima — vinte e tantas casas, que o
 * contrato recusa. Oito é a escala com que o preço é guardado.
 */
const PRICE_SCALE = 8;

type SummaryJson = {
  readonly group_key: string | null;
  readonly count: number;
  readonly value: string;
  readonly cost_basis: string;
  readonly open_result: string;
  readonly open_result_ratio: string | null;
  readonly weight: string;
};

type AggregateRow = {
  readonly summaries: readonly SummaryJson[] | null;
  readonly facets: readonly PositionViewFacetRow[] | null;
  readonly header: PositionViewHeader | null;
};

const EMPTY_HEADER: PositionViewHeader = {
  as_of: null,
  computed_at: null,
  payouts_12m: '0',
  day_change_ratio: null,
  return_12m_ratio: null,
  fresh: 0,
  stale: 0,
  manual: 0,
  missing: 0,
};

export const createPositionViewRepository = (sql: Connection): PositionViewRepository => {
  /**
   * O recorte, compartilhado pelas duas consultas. `searched` é o conjunto que
   * as pastilhas contam; `filtered` é o que a tabela mostra. A diferença entre
   * os dois é só o filtro de categoria, e é ela que faz a pastilha "Ações 14"
   * continuar dizendo 14 depois de ser clicada.
   */
  const scope = (filter: PositionViewFilter) => {
    const search = filter.search === null ? null : `%${filter.search}%`;
    const category = filter.categoryId;

    return sql`
      with scope as (
        select p.id as portfolio_id, p.name as portfolio_name
          from portfolio p
         where p.archived_at is null
           and (${filter.portfolioId}::uuid is null or p.id = ${filter.portfolioId}::uuid)
      ),
      as_of as (
        select max(pd.position_date) as position_date
          from position_daily pd
          join scope s on s.portfolio_id = pd.portfolio_id
         where pd.position_date <= ${filter.today}::date
      ),
      -- Posição zerada fica no histórico e sai de Posições (O-09).
      open_positions as (
        select pd.portfolio_id,
               pd.asset_id,
               pd.quantity,
               pd.avg_price,
               pd.cost_basis,
               pd.market_value,
               pd.price_source_kind,
               pd.computed_at,
               pd.position_date
          from position_daily pd
          join scope s on s.portfolio_id = pd.portfolio_id
          join as_of a on a.position_date = pd.position_date
         where pd.quantity <> 0 or pd.market_value <> 0
      ),
      -- Onde o papel está custodiado: a instituição do lançamento mais recente
      -- daquela carteira para aquele ativo. A projeção não tem a coluna,
      -- e não deveria ter: custódia é fato do livro, não da projeção.
      custodian as (
        select distinct on (t.portfolio_id, t.asset_id)
               t.portfolio_id,
               t.asset_id,
               t.institution_id,
               i.name as institution_name
          from transaction t
          join scope s on s.portfolio_id = t.portfolio_id
          join institution i on i.id = t.institution_id
         where t.asset_id is not null
         order by t.portfolio_id, t.asset_id, t.trade_date desc, t.created_at desc
      ),
      decorated as (
        select op.portfolio_id,
               s.portfolio_name,
               op.asset_id,
               a.ticker,
               a.name,
               a.origin,
               a.b3_type,
               a.indexer,
               a.rate,
               a.maturity_date,
               cu.institution_id,
               cu.institution_name,
               a.category_id,
               c.name as category_name,
               c.color_token,
               op.position_date,
               op.computed_at,
               op.price_source_kind,
               op.quantity,
               op.avg_price,
               op.cost_basis,
               op.market_value,
               -- Título de banco marcado na curva: a quantidade dele não diz
               -- nada a quem lê, e a tela mostra traço em vez dela.
               case
                 when a.origin = 'manual' and a.indexer is not null then 'curve'
                 else 'quantity'
               end as unit,
               case
                 when op.quantity <> 0 then op.market_value / op.quantity
               end as unit_value,
               previous.unit_value as previous_unit_value,
               year_ago.unit_value as year_ago_unit_value,
               coalesce(payouts.amount, 0) as payouts_12m,
               case
                 when op.price_source_kind = 'manual' then (
                   select max(mp.price_date)
                     from manual_price mp
                    where mp.asset_id = op.asset_id
                      and mp.price_date <= op.position_date
                 )
                 else (
                   select max(ap.price_date)
                     from asset_price ap
                    where ap.asset_id = op.asset_id
                      and ap.price_date <= op.position_date
                 )
               end as price_date
          from open_positions op
          join scope s on s.portfolio_id = op.portfolio_id
          join asset a on a.id = op.asset_id
          left join category c on c.id = a.category_id
          left join custodian cu
            on cu.portfolio_id = op.portfolio_id
           and cu.asset_id = op.asset_id
          -- A janela de dez dias cobre feriado prolongado sem varrer a série
          -- inteira: o fechamento grava todo dia útil, então o anterior está
          -- sempre dentro dela.
          left join lateral (
            select case when p.quantity <> 0 then p.market_value / p.quantity end
                     as unit_value
              from position_daily p
             where p.portfolio_id = op.portfolio_id
               and p.asset_id = op.asset_id
               and p.position_date < op.position_date
               and p.position_date >= op.position_date - 10
             order by p.position_date desc
             limit 1
          ) previous on true
          left join lateral (
            select case when p.quantity <> 0 then p.market_value / p.quantity end
                     as unit_value
              from position_daily p
             where p.portfolio_id = op.portfolio_id
               and p.asset_id = op.asset_id
               and p.position_date <= (op.position_date - interval '12 months')::date
               and p.position_date
                     >= (op.position_date - interval '12 months')::date - 10
             order by p.position_date desc
             limit 1
          ) year_ago on true
          left join lateral (
            select sum(t.net_amount) as amount
              from transaction t
             where t.portfolio_id = op.portfolio_id
               and t.asset_id = op.asset_id
               and t.kind = 'payout'
               and t.confirmed_at is not null
               and t.settlement_date <= op.position_date
               and t.settlement_date > (op.position_date - interval '12 months')::date
          ) payouts on true
      ),
      searched as (
        select *
          from decorated d
         where ${
           search === null
             ? sql`true`
             : sql`(d.ticker ilike ${search} or d.name ilike ${search})`
         }
      ),
      filtered as (
        select *
          from searched f
         where ${
           category === null
             ? sql`true`
             : category === 'sem-categoria'
               ? sql`f.category_id is null`
               : sql`f.category_id = ${category}::uuid`
         }
      ),
      grouped as (
        select f.*,
               case ${filter.groupBy}::text
                 when 'category'
                   then coalesce(f.category_id::text, 'sem-categoria')
                 when 'institution'
                   then coalesce(f.institution_id::text, 'sem-instituicao')
                 when 'portfolio' then f.portfolio_id::text
                 else 'sem-grupo'
               end as group_key,
               case ${filter.groupBy}::text
                 when 'category' then coalesce(f.category_name, 'Sem categoria')
                 when 'institution'
                   then coalesce(f.institution_name, 'Sem instituição')
                 when 'portfolio' then f.portfolio_name
                 else 'Posições'
               end as group_label,
               case
                 when ${filter.groupBy}::text = 'category' then f.color_token
               end as group_color_token,
               sum(f.market_value) over () as scope_value
          from filtered f
      )
    `;
  };

  return {
    open: async (filter: PositionViewFilter) => {
      try {
        const rows = await sql<PositionViewRow[]>`
          ${scope(filter)}
          select g.group_key,
                 g.group_label,
                 g.group_color_token,
                 g.portfolio_id,
                 g.portfolio_name,
                 g.asset_id,
                 g.ticker,
                 g.name,
                 g.origin,
                 g.b3_type,
                 g.institution_id,
                 g.institution_name,
                 g.category_id,
                 g.category_name,
                 g.color_token,
                 g.unit,
                 case when g.unit = 'quantity' then g.quantity::text end as quantity,
                 case when g.unit = 'quantity' then g.avg_price::text end as avg_price,
                 case
                   when g.unit = 'quantity'
                   then round(g.unit_value, ${PRICE_SCALE})::text
                 end as price,
                 g.price_source_kind as price_health,
                 g.price_date,
                 g.market_value::text as value,
                 g.cost_basis::text as cost_basis,
                 (g.market_value - g.cost_basis)::text as open_result,
                 round(
                   (g.market_value - g.cost_basis) / nullif(g.cost_basis, 0),
                   ${RATIO_SCALE}
                 )::text as open_result_ratio,
                 round(
                   g.market_value / nullif(g.scope_value, 0),
                   ${RATIO_SCALE}
                 )::text as weight,
                 round(
                   g.unit_value / nullif(g.previous_unit_value, 0) - 1,
                   ${RATIO_SCALE}
                 )::text as day_change_ratio,
                 round(
                   g.unit_value / nullif(g.year_ago_unit_value, 0) - 1,
                   ${RATIO_SCALE}
                 )::text as return_12m_ratio,
                 -- Nenhum provento em doze meses é ausência de provento, e
                 -- não rendimento de zero por cento: a tela mostra o detalhe
                 -- do papel em vez de um "DY 0,0%" que não quer dizer nada.
                 round(
                   nullif(g.payouts_12m, 0) / nullif(g.market_value, 0),
                   ${RATIO_SCALE}
                 )::text as dividend_yield_12m,
                 g.indexer,
                 g.rate::text as rate,
                 g.maturity_date
            from grouped g
           order by sum(g.market_value) over (partition by g.group_key) desc,
                    g.group_key,
                    g.market_value desc,
                    g.ticker
        `;

        const aggregates = await sql<AggregateRow[]>`
          ${scope(filter)},
          summaries as (
            select g.group_key,
                   count(*)::int as count,
                   coalesce(sum(g.market_value), 0)::text as value,
                   coalesce(sum(g.cost_basis), 0)::text as cost_basis,
                   coalesce(sum(g.market_value - g.cost_basis), 0)::text as open_result,
                   round(
                     sum(g.market_value - g.cost_basis) / nullif(sum(g.cost_basis), 0),
                     ${RATIO_SCALE}
                   )::text as open_result_ratio,
                   round(
                     coalesce(sum(g.market_value), 0) / nullif(max(g.scope_value), 0),
                     ${RATIO_SCALE}
                   )::text as weight,
                   -- O total geral vem do mesmo lugar que os subtotais, para
                   -- não haver dois caminhos somando o mesmo dinheiro.
                   grouping(g.group_key) as is_total
              from grouped g
             group by grouping sets ((g.group_key), ())
          ),
          facets as (
            select coalesce(s.category_id::text, 'sem-categoria') as id,
                   coalesce(s.category_name, 'Sem categoria') as label,
                   s.color_token,
                   count(*)::int as count,
                   sum(s.market_value) as value
              from searched s
             group by 1, 2, 3
          ),
          quota as (
            select pd.position_date, pd.quota_value
              from portfolio_daily pd
             where ${filter.portfolioId}::uuid is not null
               and pd.portfolio_id = ${filter.portfolioId}::uuid
               and pd.position_date <= (select position_date from as_of)
          ),
          header as (
            select (select position_date from as_of) as as_of,
                   (select max(computed_at) from open_positions) as computed_at,
                   coalesce((
                     select sum(t.net_amount)
                       from transaction t
                       join scope s on s.portfolio_id = t.portfolio_id
                      where t.kind = 'payout'
                        and t.confirmed_at is not null
                        and t.settlement_date <= (select position_date from as_of)
                        and t.settlement_date
                              > ((select position_date from as_of)
                                 - interval '12 months')::date
                   ), 0)::text as payouts_12m,
                   round(
                     (select quota_value from quota order by position_date desc limit 1)
                     / nullif((
                         select quota_value from quota
                          where position_date < (select position_date from as_of)
                          order by position_date desc limit 1
                       ), 0) - 1,
                     ${RATIO_SCALE}
                   )::text as day_change_ratio,
                   round(
                     (select quota_value from quota order by position_date desc limit 1)
                     / nullif((
                         select quota_value from quota
                          where position_date
                                  <= ((select position_date from as_of)
                                      - interval '12 months')::date
                          order by position_date desc limit 1
                       ), 0) - 1,
                     ${RATIO_SCALE}
                   )::text as return_12m_ratio,
                   count(*) filter (where o.price_source_kind = 'fresh')::int as fresh,
                   count(*) filter (where o.price_source_kind = 'stale')::int as stale,
                   count(*) filter (where o.price_source_kind = 'manual')::int as manual,
                   count(*) filter (where o.price_source_kind = 'missing')::int
                     as missing
              from open_positions o
          )
          select (
                   select json_agg(
                            json_build_object(
                              'group_key', case when s.is_total = 1 then null
                                                else s.group_key end,
                              'count', s.count,
                              'value', s.value,
                              'cost_basis', s.cost_basis,
                              'open_result', s.open_result,
                              'open_result_ratio', s.open_result_ratio,
                              'weight', coalesce(s.weight, '0')
                            )
                          )
                     from summaries s
                 ) as summaries,
                 (
                   select json_agg(
                            json_build_object(
                              'id', f.id,
                              'label', f.label,
                              'color_token', f.color_token,
                              'count', f.count
                            )
                            order by f.value desc
                          )
                     from facets f
                 ) as facets,
                 (select row_to_json(h) from header h) as header
        `;

        const aggregate = aggregates[0];

        return success({
          rows,
          summaries: (aggregate?.summaries ?? []) as readonly PositionViewSummaryRow[],
          facets: aggregate?.facets ?? [],
          header: aggregate?.header ?? EMPTY_HEADER,
        } satisfies PositionView);
      } catch (error) {
        return failure(getRepositoryError(error));
      }
    },
  };
};
