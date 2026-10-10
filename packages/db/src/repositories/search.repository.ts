import type {
  SearchAssetRow,
  SearchFilter,
  SearchPageView,
  SearchRepository,
  SearchTransactionRow,
} from '@patrimonio/application';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';
import { likeContains, likePrefix } from '../support/like.js';

/**
 * T-09 · A busca global em duas consultas.
 *
 * Uma para ativos, outra para lançamentos. Elas não dependem uma da outra, e
 * por isso saem juntas: a paleta abre em menos de cem milissegundos porque o
 * que ela mostra primeiro nem passa por aqui, e o que passa por aqui paga a
 * ida ao banco **uma vez**, e não duas em série. O orçamento por rota (T-11)
 * conta consultas, e a resposta é duas.
 *
 * Duas decisões moram na consulta de ativos, e as duas existem para "o mais
 * provável primeiro" ser verdade:
 *
 * - **O que a pessoa tem vem antes do que ela só encontra.** Buscar "itu" traz
 *   ITUB3 e ITUB4 empatados no texto; o desempate é ter posição. Sem ele, a
 *   ordem alfabética põe em primeiro o papel que ela não tem.
 * - **A posição só é lida para os candidatos.** Os cinquenta primeiros por
 *   texto entram no cálculo de posição; ler o último dia de `position_daily` de
 *   todo ativo que contém "a" faria uma busca de uma letra custar mais que o
 *   extrato inteiro. O total, porém, é contado sobre todos os que casam.
 *
 * A comparação ignora acento (`unaccent`, migration 031): "itau" acha "Itaú", como
 * a paleta pontua. O `ilike` sozinho os trataria como letras diferentes.
 *
 * Valor e quantidade são `numeric` do Postgres e saem como `text`, como no resto
 * da aplicação.
 */

/** Quantos candidatos por texto entram no desempate por posição. */
const CANDIDATES = 50;

type AssetResultRow = Omit<SearchAssetRow, 'portfolio_names'> & {
  readonly total: number;
  readonly portfolio_names: readonly string[] | null;
};

type TransactionResultRow = SearchTransactionRow & { readonly total: number };

export const createSearchRepository = (sql: Connection): SearchRepository => ({
  find: async (filter: SearchFilter) => {
    try {
      const contains = likeContains(filter.text);
      const prefix = likePrefix(filter.text);

      const [assets, transactions] = await Promise.all([
        sql<AssetResultRow[]>`
          with scope as (
            select p.id, p.name, p.sort_order
              from portfolio p
             where p.archived_at is null
               and (${filter.portfolioId}::uuid is null or p.id = ${filter.portfolioId}::uuid)
          ),
          candidates as (
            select a.id, a.ticker, a.name, a.b3_type,
                   case
                     when unaccent(lower(a.ticker)) = unaccent(lower(${filter.text}::text)) then 0
                     when unaccent(a.ticker) ilike unaccent(${prefix}::text) then 1
                     when unaccent(a.name) ilike unaccent(${prefix}::text) then 2
                     when unaccent(a.ticker) ilike unaccent(${contains}::text) then 3
                     else 4
                   end as match_rank,
                   count(*) over () as total
              from asset a
             where a.archived_at is null
               and (unaccent(a.ticker) ilike unaccent(${contains}::text)
                    or unaccent(a.name) ilike unaccent(${contains}::text))
             order by match_rank, a.ticker
             limit ${CANDIDATES}
          )
          select c.id, c.ticker, c.name, c.b3_type, c.total::int as total,
                 h.quantity::text as quantity,
                 h.market_value::numeric(20,2)::text as market_value,
                 h.portfolio_names
            from candidates c
            left join lateral (
              select sum(l.quantity) as quantity,
                     sum(l.market_value) as market_value,
                     array_agg(l.name order by l.sort_order, l.name) as portfolio_names
                from (
                  select s.name, s.sort_order, p.quantity, p.market_value
                    from scope s
                    cross join lateral (
                      select pd.quantity, pd.market_value
                        from position_daily pd
                       where pd.asset_id = c.id
                         and pd.portfolio_id = s.id
                       order by pd.position_date desc
                       limit 1
                    ) p
                   where p.quantity > 0
                ) l
            ) h on true
           order by c.match_rank, (h.quantity is not null) desc, c.ticker
           limit ${filter.limit}
        `,
        sql<TransactionResultRow[]>`
          select t.id,
                 t.kind::text as kind,
                 t.payout_kind::text as payout_kind,
                 t.trade_date::text as trade_date,
                 t.portfolio_id,
                 p.name as portfolio_name,
                 t.asset_id,
                 a.ticker,
                 a.name as asset_name,
                 a.b3_type,
                 t.quantity::text as quantity,
                 t.net_amount::numeric(20,2)::text as net_amount,
                 t.confirmed_at::text as confirmed_at,
                 count(*) over ()::int as total
            from transaction t
            join portfolio p on p.id = t.portfolio_id and p.archived_at is null
            left join asset a on a.id = t.asset_id
           where (${filter.portfolioId}::uuid is null
                  or t.portfolio_id = ${filter.portfolioId}::uuid)
             and (unaccent(a.ticker) ilike unaccent(${contains}::text)
                  or unaccent(a.name) ilike unaccent(${contains}::text)
                  or unaccent(t.note) ilike unaccent(${contains}::text))
           order by t.trade_date desc, t.id desc
           limit ${filter.limit}
        `,
      ]);

      const view: SearchPageView = {
        assets: {
          total: assets[0]?.total ?? 0,
          rows: assets.map(
            ({ total: _total, portfolio_names, ...row }): SearchAssetRow => ({
              ...row,
              portfolio_names: portfolio_names ?? [],
            }),
          ),
        },
        transactions: {
          total: transactions[0]?.total ?? 0,
          rows: transactions.map(
            ({ total: _total, ...row }): SearchTransactionRow => row,
          ),
        },
      };

      return success(view);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
