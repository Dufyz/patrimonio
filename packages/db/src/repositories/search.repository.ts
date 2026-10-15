import type {
  SearchAssetRow,
  SearchInstrumentRow,
  SearchFilter,
  SearchPageView,
  SearchRepository,
  SearchTransactionRow,
} from '@patrimonio/application';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';
import { ARRAY_OID } from '../support/array_oid.js';
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
 * A mesma consulta devolve uma linha de estado: o catálogo tem ou não papel ativo.
 *
 * A comparação ignora acento (`unaccent`, migration 031): "itau" acha "Itaú", como
 * a paleta pontua. O `ilike` sozinho os trataria como letras diferentes.
 *
 * Valor e quantidade são `numeric` do Postgres e saem como `text`, como no resto
 * da aplicação.
 */

/** Quantos candidatos por texto entram no desempate por posição. */
const CANDIDATES = 50;

/**
 * O catálogo casa por palavra: "selic 2029" acha "Tesouro Selic 2029" mesmo com
 * "tesouro" no meio, e "ipca 2035" acha "Tesouro IPCA+ 2035" porque o "+" do nome
 * não conta. Cada palavra precisa estar no código ou no nome.
 */
const catalogTerms = (text: string): readonly string[] => {
  const words = text
    .replace(/\+/gu, '')
    .split(/\s+/u)
    .filter((word) => word !== '');

  return (words.length === 0 ? [text] : words).map((word) => likeContains(word));
};

type AssetResultRow = Omit<SearchAssetRow, 'portfolio_names' | 'id' | 'b3_type'> & {
  readonly row_kind: 'asset' | 'catalog' | 'catalog_state';
  readonly id: string | null;
  readonly b3_type: string | null;
  readonly maturity_date: string | null;
  readonly total: number;
  readonly portfolio_names: readonly string[] | null;
};

type TransactionResultRow = SearchTransactionRow & { readonly total: number };

export const createSearchRepository = (sql: Connection): SearchRepository => ({
  find: async (filter: SearchFilter) => {
    try {
      const contains = likeContains(filter.text);
      const prefix = likePrefix(filter.text);
      const wanted = catalogTerms(filter.text);

      const [assets, transactions] = await Promise.all([
        sql<AssetResultRow[]>`
          WITH scope AS (
            SELECT p.id, p.name, p.sort_order
              FROM portfolio p
             WHERE p.archived_at IS NULL
               AND (${filter.portfolioId}::UUID IS NULL OR p.id = ${filter.portfolioId}::UUID)
          ),
          candidates AS (
            SELECT a.id, a.ticker, a.name, a.b3_type,
                   CASE
                     WHEN unaccent(LOWER(a.ticker)) = unaccent(LOWER(${filter.text}::TEXT)) THEN 0
                     WHEN unaccent(a.ticker) ILIKE unaccent(${prefix}::TEXT) THEN 1
                     WHEN unaccent(a.name) ILIKE unaccent(${prefix}::TEXT) THEN 2
                     WHEN unaccent(a.ticker) ILIKE unaccent(${contains}::TEXT) THEN 3
                     ELSE 4
                   END AS match_rank,
                   COUNT(*) OVER () AS total
              FROM asset a
             WHERE a.archived_at IS NULL
               AND (unaccent(a.ticker) ILIKE unaccent(${contains}::TEXT)
                    OR unaccent(a.name) ILIKE unaccent(${contains}::TEXT))
             ORDER BY match_rank, a.ticker
             LIMIT ${CANDIDATES}
          ),
          listed_catalog AS (
            SELECT i.ticker, i.name, i.b3_type, i.maturity_date,
                   CASE
                     WHEN unaccent(LOWER(i.ticker)) = unaccent(LOWER(${filter.text}::TEXT)) THEN 0
                     WHEN unaccent(i.ticker) ILIKE unaccent(${prefix}::TEXT) THEN 1
                     WHEN unaccent(i.name) ILIKE unaccent(${prefix}::TEXT) THEN 2
                     WHEN unaccent(i.ticker) ILIKE unaccent(${contains}::TEXT) THEN 3
                     ELSE 4
                   END AS match_rank,
                   COUNT(*) OVER () AS total
              FROM listed_instrument i
             WHERE i.active
               AND NOT EXISTS (
                     SELECT 1 FROM asset a
                      WHERE a.ticker = i.ticker AND a.archived_at IS NULL
                   )
               AND NOT EXISTS (
                     SELECT 1
                       FROM unnest(${sql.array([...wanted], ARRAY_OID.text)}::TEXT[]) AS w(pattern)
                      WHERE NOT (unaccent(i.ticker) ILIKE unaccent(w.pattern)
                                 OR unaccent(REPLACE(i.name, '+', '')) ILIKE unaccent(w.pattern))
                   )
          )
          (SELECT 'asset' AS row_kind, c.id, c.ticker, c.name, c.b3_type,
                 NULL::TEXT AS maturity_date, c.total::INT AS total,
                 h.quantity::TEXT AS quantity,
                 h.market_value::NUMERIC(20,2)::TEXT AS market_value,
                 h.portfolio_names
            FROM candidates c
            LEFT JOIN LATERAL (
              SELECT SUM(l.quantity) AS quantity,
                     SUM(l.market_value) AS market_value,
                     ARRAY_AGG(l.name ORDER BY l.sort_order, l.name) AS portfolio_names
                FROM (
                  SELECT s.name, s.sort_order, p.quantity, p.market_value
                    FROM scope s
                    CROSS JOIN LATERAL (
                      SELECT pd.quantity, pd.market_value
                        FROM position_daily pd
                       WHERE pd.asset_id = c.id
                         AND pd.portfolio_id = s.id
                       ORDER BY pd.position_date DESC
                       LIMIT 1
                    ) p
                   WHERE p.quantity > 0
                ) l
            ) h ON TRUE
           ORDER BY c.match_rank, (h.quantity IS NOT NULL) DESC, c.ticker
           LIMIT ${filter.limit})
          UNION ALL
          (SELECT 'catalog' AS row_kind, NULL::UUID AS id, k.ticker, k.name, k.b3_type,
                 k.maturity_date::TEXT AS maturity_date, k.total::INT AS total,
                 NULL::TEXT AS quantity, NULL::TEXT AS market_value,
                 NULL::TEXT[] AS portfolio_names
            FROM listed_catalog k
           ORDER BY k.match_rank, k.ticker
           LIMIT ${filter.limit})
          UNION ALL
          (SELECT 'catalog_state' AS row_kind, NULL::UUID AS id, '' AS ticker, '' AS name,
                 NULL::TEXT AS b3_type, NULL::TEXT AS maturity_date,
                 (CASE WHEN EXISTS (SELECT 1 FROM listed_instrument WHERE active)
                       THEN 1 ELSE 0 END) AS total,
                 NULL::TEXT AS quantity, NULL::TEXT AS market_value,
                 NULL::TEXT[] AS portfolio_names)
        `,
        sql<TransactionResultRow[]>`
          SELECT t.id,
                 t.kind::TEXT AS kind,
                 t.payout_kind::TEXT AS payout_kind,
                 t.trade_date::TEXT AS trade_date,
                 t.portfolio_id,
                 p.name AS portfolio_name,
                 t.asset_id,
                 a.ticker,
                 a.name AS asset_name,
                 a.b3_type,
                 t.quantity::TEXT AS quantity,
                 t.net_amount::NUMERIC(20,2)::TEXT AS net_amount,
                 t.confirmed_at::TEXT AS confirmed_at,
                 COUNT(*) OVER ()::INT AS total
            FROM transaction t
            JOIN portfolio p ON p.id = t.portfolio_id AND p.archived_at IS NULL
            LEFT JOIN asset a ON a.id = t.asset_id
           WHERE (${filter.portfolioId}::UUID IS NULL
                  OR t.portfolio_id = ${filter.portfolioId}::UUID)
             AND (unaccent(a.ticker) ILIKE unaccent(${contains}::TEXT)
                  OR unaccent(a.name) ILIKE unaccent(${contains}::TEXT))
           ORDER BY t.trade_date DESC, t.id DESC
           LIMIT ${filter.limit}
        `,
      ]);

      const assetRows = assets.filter((row) => row.row_kind === 'asset');
      const catalogRows = assets.filter((row) => row.row_kind === 'catalog');
      const catalogState = assets.find((row) => row.row_kind === 'catalog_state');

      const view: SearchPageView = {
        assets: {
          total: assetRows[0]?.total ?? 0,
          rows: assetRows.map(
            ({
              total: _total,
              row_kind: _kind,
              maturity_date: _maturity,
              portfolio_names,
              id,
              b3_type,
              ...row
            }): SearchAssetRow => ({
              ...row,
              id: id as string,
              b3_type: b3_type as SearchAssetRow['b3_type'],
              portfolio_names: portfolio_names ?? [],
            }),
          ),
        },
        instruments: {
          total: catalogRows[0]?.total ?? 0,
          catalog_empty: (catalogState?.total ?? 0) === 0,
          rows: catalogRows.map((row): SearchInstrumentRow => ({
            ticker: row.ticker,
            name: row.name,
            b3_type: row.b3_type as SearchInstrumentRow['b3_type'],
            maturity_date: row.maturity_date as SearchInstrumentRow['maturity_date'],
          })),
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
