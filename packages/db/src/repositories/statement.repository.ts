import type {
  StatementFilter,
  StatementHistoryRow,
  StatementPageView,
  StatementPair,
  StatementRepository,
} from '@patrimonio/application';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * T-04 · O extrato do livro em duas consultas.
 *
 * A primeira traz a página de lançamentos e **todos** os agregados do recorte —
 * resumo, subtotal de mês, contagem por tipo, instituições, o mês anterior ao
 * período — numa linha de JSON; a segunda traz o livro dos ativos que aparecem
 * na página, para o motor refazer o preço médio. Duas, e não nove, porque o
 * banco fica em outra rede e o orçamento por rota (T-11) é verificado por teste.
 *
 * Toda soma é `numeric` do Postgres e sai como `text`: `numeric(20,2)` não cabe
 * em `double`, e um centavo perdido no transporte reaparece como um extrato que
 * não confere com a corretora.
 *
 * Quatro camadas de filtro, e a diferença entre elas é o que faz a tela funcionar:
 *
 * - `scoped` é o escopo (carteira) e nada mais. Dela saem o "312 lançamentos
 *   desde mar/2021" e a lista de instituições, que não encolhem quando alguém
 *   escolhe uma.
 * - `unbounded` aplica instituição, busca e tipo, mas **não o período**. É dela
 *   que sai o "Ampliar o período para agosto": a pergunta é o que existe antes
 *   do início, sob os mesmos outros filtros.
 * - `narrowed` aplica instituição, busca e período, mas **não o tipo**. É dela
 *   que saem as contagens das pastilhas — contar sob o tipo escolhido zeraria
 *   todas as outras no primeiro clique.
 * - `filtered` aplica tudo, e é o recorte que a tabela, o resumo e os subtotais
 *   descrevem.
 */

const GROUP_KINDS: Readonly<Record<string, readonly string[]>> = {
  buy: ['buy'],
  sell: ['sell'],
  payout: ['payout'],
  cash: ['deposit', 'withdrawal'],
  transfer: ['transfer'],
  event: ['corporate_event'],
};

const FACET_ORDER = ['buy', 'sell', 'payout', 'cash', 'transfer', 'event'] as const;

/** `%` e `_` digitados pela pessoa são texto, não curinga. */
const likePattern = (term: string): string =>
  `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

type AggregateRow = {
  readonly page: Omit<StatementPageView, 'facets'> & {
    readonly facet_counts: Readonly<Record<string, number>>;
  };
};

export const createStatementRepository = (sql: Connection): StatementRepository => ({
  page: async (filter: StatementFilter) => {
    try {
      const offset = (filter.page - 1) * filter.limit;
      const pattern = filter.search === null ? null : likePattern(filter.search);
      const kinds = filter.group === null ? null : [...(GROUP_KINDS[filter.group] ?? [])];
      const groupKinds = kinds === null ? null : sql.array(kinds);

      const aggregates = await sql<AggregateRow[]>`
        with scope as (
          select p.id, p.name, p.recalc_status
            from portfolio p
           where p.archived_at is null
             and (${filter.portfolioId}::uuid is null or p.id = ${filter.portfolioId}::uuid)
        ),
        scoped as (
          select t.*,
                 s.name as portfolio_name,
                 i.name as institution_name,
                 a.ticker,
                 a.name as asset_name,
                 a.b3_type
            from transaction t
            join scope s on s.id = t.portfolio_id
            join institution i on i.id = t.institution_id
            left join asset a on a.id = t.asset_id
        ),
        matching as (
          select *
            from scoped
           where (${filter.institutionId}::uuid is null
                  or institution_id = ${filter.institutionId}::uuid)
             and (${pattern}::text is null
                  or ticker ilike ${pattern}::text
                  or asset_name ilike ${pattern}::text)
        ),
        narrowed as (
          select *
            from matching
           where (${filter.from}::date is null or trade_date >= ${filter.from}::date)
             and (${filter.to}::date is null or trade_date <= ${filter.to}::date)
        ),
        filtered as (
          select *
            from narrowed
           where ${groupKinds}::text[] is null
              or kind::text = any(${groupKinds}::text[])
        ),
        unbounded as (
          select *
            from matching
           where ${groupKinds}::text[] is null
              or kind::text = any(${groupKinds}::text[])
        ),
        before_period as (
          select max(trade_date) as last_date
            from unbounded
           where ${filter.from}::date is not null
             and trade_date < ${filter.from}::date
        ),
        paged as (
          select f.*
            from filtered f
           order by f.trade_date desc, f.id desc
          offset ${offset} limit ${filter.limit}
        )
        select jsonb_build_object(
          'scope', jsonb_build_object(
            'portfolio_id', ${filter.portfolioId}::uuid,
            'portfolio_name', (
              select s.name from scope s where s.id = ${filter.portfolioId}::uuid
            ),
            'entries_total', (select count(*) from scoped),
            'first_trade_date', (select min(trade_date)::text from scoped)
          ),
          'summary', (
            select jsonb_build_object(
              'count', count(*),
              'deposits', coalesce(sum(net_amount) filter (where kind = 'deposit'), 0)::numeric(20,2)::text,
              'withdrawals', coalesce(sum(abs(net_amount)) filter (where kind = 'withdrawal'), 0)::numeric(20,2)::text,
              'buys', coalesce(sum(abs(net_amount)) filter (where kind = 'buy'), 0)::numeric(20,2)::text,
              'sells', coalesce(sum(net_amount) filter (where kind = 'sell'), 0)::numeric(20,2)::text,
              'payouts', coalesce(sum(net_amount) filter (
                where kind = 'payout' and confirmed_at is not null
              ), 0)::numeric(20,2)::text
            )
            from filtered
          ),
          'facet_counts', (
            select coalesce(jsonb_object_agg(g.grp, g.total), '{}'::jsonb)
              from (
                select case kind::text
                         when 'buy' then 'buy'
                         when 'sell' then 'sell'
                         when 'payout' then 'payout'
                         when 'deposit' then 'cash'
                         when 'withdrawal' then 'cash'
                         when 'transfer' then 'transfer'
                         else 'event'
                       end as grp,
                       count(*) as total
                  from narrowed
                 group by 1
              ) g
          ),
          'facets_total', (select count(*) from narrowed),
          'institutions', coalesce((
            select jsonb_agg(
                     jsonb_build_object('id', x.id, 'name', x.name, 'count', x.total)
                     order by x.name
                   )
              from (
                select institution_id as id, institution_name as name, count(*) as total
                  from scoped
                 group by institution_id, institution_name
              ) x
          ), '[]'::jsonb),
          'months', coalesce((
            select jsonb_agg(m.item order by m.month desc)
              from (
                select to_char(trade_date, 'YYYY-MM') as month,
                       jsonb_build_object(
                         'month', to_char(trade_date, 'YYYY-MM'),
                         'count', count(*),
                         'deposits', coalesce(sum(net_amount) filter (where kind = 'deposit'), 0)::numeric(20,2)::text,
                         'withdrawals', coalesce(sum(abs(net_amount)) filter (where kind = 'withdrawal'), 0)::numeric(20,2)::text,
                         'buys', coalesce(sum(abs(net_amount)) filter (where kind = 'buy'), 0)::numeric(20,2)::text,
                         'sells', coalesce(sum(net_amount) filter (where kind = 'sell'), 0)::numeric(20,2)::text,
                         'payouts', coalesce(sum(net_amount) filter (
                           where kind = 'payout' and confirmed_at is not null
                         ), 0)::numeric(20,2)::text
                       ) as item
                  from filtered
                 group by to_char(trade_date, 'YYYY-MM')
              ) m
          ), '[]'::jsonb),
          'total', (select count(*) from filtered),
          'rows', coalesce((
            select jsonb_agg(
                     jsonb_build_object(
                       'id', p.id,
                       'kind', p.kind::text,
                       'payout_kind', p.payout_kind::text,
                       'trade_date', p.trade_date::text,
                       'settlement_date', p.settlement_date::text,
                       'portfolio_id', p.portfolio_id,
                       'portfolio_name', p.portfolio_name,
                       'institution_id', p.institution_id,
                       'institution_name', p.institution_name,
                       'asset_id', p.asset_id,
                       'ticker', p.ticker,
                       'asset_name', p.asset_name,
                       'b3_type', p.b3_type::text,
                       'quantity', p.quantity::text,
                       'unit_price', p.unit_price::text,
                       'fees', p.fees::text,
                       'gross_amount', p.gross_amount::text,
                       'tax_withheld', p.tax_withheld::text,
                       'net_amount', p.net_amount::text,
                       'expected_net_amount', p.expected_net_amount::text,
                       'confirmed_at', p.confirmed_at,
                       'transfer_group_id', p.transfer_group_id,
                       'event_ratio_from', p.event_ratio_from::text,
                       'event_ratio_to', p.event_ratio_to::text,
                       'note', p.note,
                       'realized_exempt', r.exempt,
                       'transfer_counterpart', (
                         select s2.name
                           from transaction t2
                           join portfolio s2 on s2.id = t2.portfolio_id
                          where p.transfer_group_id is not null
                            and t2.transfer_group_id = p.transfer_group_id
                            and t2.id <> p.id
                          limit 1
                       )
                     )
                     order by p.trade_date desc, p.id desc
                   )
              from paged p
              left join realized_result r on r.transaction_id = p.id
          ), '[]'::jsonb),
          'earlier', (
            select jsonb_build_object(
                     'month', to_char(b.last_date, 'YYYY-MM'),
                     'count', (
                       select count(*)
                         from unbounded u
                        where to_char(u.trade_date, 'YYYY-MM') = to_char(b.last_date, 'YYYY-MM')
                          and u.trade_date < ${filter.from}::date
                     )
                   )
              from before_period b
             where b.last_date is not null
          ),
          'recalculation', (
            select jsonb_build_object(
                     'pending', count(*) filter (where recalc_status in ('queued', 'running')),
                     'failed', count(*) filter (where recalc_status = 'failed')
                   )
              from scope
          )
        ) as page
      `;

      const page = aggregates[0]?.page;

      if (page === undefined) {
        return failure(getRepositoryError(new Error('o extrato não devolveu linha')));
      }

      const { facet_counts: counts, ...rest } = page;

      return success({
        ...rest,
        facets: FACET_ORDER.map((group) => ({ group, count: counts[group] ?? 0 })),
      } satisfies StatementPageView);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  history: async (pairs: readonly StatementPair[], until) => {
    if (pairs.length === 0) return success([] as readonly StatementHistoryRow[]);

    try {
      const rows = await sql<StatementHistoryRow[]>`
        select t.id,
               t.portfolio_id,
               t.asset_id,
               t.kind::text as kind,
               t.trade_date::text as trade_date,
               t.quantity::text as quantity,
               t.unit_price::text as unit_price,
               t.fees::text as fees,
               t.net_amount::text as net_amount,
               t.payout_kind::text as payout_kind,
               t.event_ratio_from::text as event_ratio_from,
               t.event_ratio_to::text as event_ratio_to
          from transaction t
          join unnest(
                 ${sql.array(pairs.map((pair) => pair.portfolio_id))}::uuid[],
                 ${sql.array(pairs.map((pair) => pair.asset_id))}::uuid[]
               ) as wanted(portfolio_id, asset_id)
            on wanted.portfolio_id = t.portfolio_id
           and wanted.asset_id = t.asset_id
         where t.trade_date <= ${until}::date
         order by t.trade_date, t.id
      `;

      return success(rows as readonly StatementHistoryRow[]);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
