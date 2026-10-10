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
  event: ['corporate_event'],
};

const FACET_ORDER = ['buy', 'sell', 'payout', 'cash', 'event'] as const;

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
        WITH scope AS (
          SELECT p.id, p.name, p.recalc_status
            FROM portfolio p
           WHERE p.archived_at IS NULL
             AND p.id = ${filter.portfolioId}::UUID
        ),
        scoped AS (
          SELECT t.*,
                 s.name AS portfolio_name,
                 i.name AS institution_name,
                 a.ticker,
                 a.name AS asset_name,
                 a.b3_type
            FROM transaction t
            JOIN scope s ON s.id = t.portfolio_id
            JOIN institution i ON i.id = t.institution_id
            LEFT JOIN asset a ON a.id = t.asset_id
        ),
        matching AS (
          SELECT *
            FROM scoped
           WHERE (${filter.institutionId}::UUID IS NULL
                  OR institution_id = ${filter.institutionId}::UUID)
             AND (${pattern}::TEXT IS NULL
                  OR ticker ILIKE ${pattern}::TEXT
                  OR asset_name ILIKE ${pattern}::TEXT)
        ),
        narrowed AS (
          SELECT *
            FROM matching
           WHERE (${filter.from}::DATE IS NULL OR trade_date >= ${filter.from}::DATE)
             AND (${filter.to}::DATE IS NULL OR trade_date <= ${filter.to}::DATE)
        ),
        filtered AS (
          SELECT *
            FROM narrowed
           WHERE ${groupKinds}::TEXT[] IS NULL
              OR kind::TEXT = ANY(${groupKinds}::TEXT[])
        ),
        UNBOUNDED AS (
          SELECT *
            FROM matching
           WHERE ${groupKinds}::TEXT[] IS NULL
              OR kind::TEXT = ANY(${groupKinds}::TEXT[])
        ),
        before_period AS (
          SELECT MAX(trade_date) AS last_date
            FROM UNBOUNDED
           WHERE ${filter.from}::DATE IS NOT NULL
             AND trade_date < ${filter.from}::DATE
        ),
        paged AS (
          SELECT f.*
            FROM filtered f
           ORDER BY f.trade_date DESC, f.id DESC
          OFFSET ${offset} LIMIT ${filter.limit}
        )
        SELECT JSONB_BUILD_OBJECT(
          'scope', JSONB_BUILD_OBJECT(
            'portfolio_id', ${filter.portfolioId}::UUID,
            'portfolio_name', (
              SELECT s.name FROM scope s WHERE s.id = ${filter.portfolioId}::UUID
            ),
            'entries_total', (SELECT COUNT(*) FROM scoped),
            'first_trade_date', (SELECT MIN(trade_date)::TEXT FROM scoped)
          ),
          'summary', (
            SELECT JSONB_BUILD_OBJECT(
              'count', COUNT(*),
              'deposits', COALESCE(SUM(net_amount) FILTER (WHERE kind = 'deposit'), 0)::NUMERIC(20,2)::TEXT,
              'withdrawals', COALESCE(SUM(ABS(net_amount)) FILTER (WHERE kind = 'withdrawal'), 0)::NUMERIC(20,2)::TEXT,
              'buys', COALESCE(SUM(ABS(net_amount)) FILTER (WHERE kind = 'buy'), 0)::NUMERIC(20,2)::TEXT,
              'sells', COALESCE(SUM(net_amount) FILTER (WHERE kind = 'sell'), 0)::NUMERIC(20,2)::TEXT,
              'payouts', COALESCE(SUM(net_amount) FILTER (
                WHERE kind = 'payout' AND confirmed_at IS NOT NULL
              ), 0)::NUMERIC(20,2)::TEXT
            )
            FROM filtered
          ),
          'facet_counts', (
            SELECT COALESCE(JSONB_OBJECT_AGG(g.grp, g.total), '{}'::JSONB)
              FROM (
                SELECT CASE kind::TEXT
                         WHEN 'buy' THEN 'buy'
                         WHEN 'sell' THEN 'sell'
                         WHEN 'payout' THEN 'payout'
                         WHEN 'deposit' THEN 'cash'
                         WHEN 'withdrawal' THEN 'cash'
                         ELSE 'event'
                       END AS grp,
                       COUNT(*) AS total
                  FROM narrowed
                 GROUP BY 1
              ) g
          ),
          'facets_total', (SELECT COUNT(*) FROM narrowed),
          'institutions', COALESCE((
            SELECT JSONB_AGG(
                     JSONB_BUILD_OBJECT('id', x.id, 'name', x.name, 'count', x.total)
                     ORDER BY x.name
                   )
              FROM (
                SELECT institution_id AS id, institution_name AS name, COUNT(*) AS total
                  FROM scoped
                 GROUP BY institution_id, institution_name
              ) x
          ), '[]'::JSONB),
          'months', COALESCE((
            SELECT JSONB_AGG(m.item ORDER BY m.month DESC)
              FROM (
                SELECT TO_CHAR(trade_date, 'YYYY-MM') AS month,
                       JSONB_BUILD_OBJECT(
                         'month', TO_CHAR(trade_date, 'YYYY-MM'),
                         'count', COUNT(*),
                         'deposits', COALESCE(SUM(net_amount) FILTER (WHERE kind = 'deposit'), 0)::NUMERIC(20,2)::TEXT,
                         'withdrawals', COALESCE(SUM(ABS(net_amount)) FILTER (WHERE kind = 'withdrawal'), 0)::NUMERIC(20,2)::TEXT,
                         'buys', COALESCE(SUM(ABS(net_amount)) FILTER (WHERE kind = 'buy'), 0)::NUMERIC(20,2)::TEXT,
                         'sells', COALESCE(SUM(net_amount) FILTER (WHERE kind = 'sell'), 0)::NUMERIC(20,2)::TEXT,
                         'payouts', COALESCE(SUM(net_amount) FILTER (
                           WHERE kind = 'payout' AND confirmed_at IS NOT NULL
                         ), 0)::NUMERIC(20,2)::TEXT
                       ) AS item
                  FROM filtered
                 GROUP BY TO_CHAR(trade_date, 'YYYY-MM')
              ) m
          ), '[]'::JSONB),
          'total', (SELECT COUNT(*) FROM filtered),
          'rows', COALESCE((
            SELECT JSONB_AGG(
                     JSONB_BUILD_OBJECT(
                       'id', p.id,
                       'kind', p.kind::TEXT,
                       'payout_kind', p.payout_kind::TEXT,
                       'trade_date', p.trade_date::TEXT,
                       'settlement_date', p.settlement_date::TEXT,
                       'portfolio_id', p.portfolio_id,
                       'portfolio_name', p.portfolio_name,
                       'institution_id', p.institution_id,
                       'institution_name', p.institution_name,
                       'asset_id', p.asset_id,
                       'ticker', p.ticker,
                       'asset_name', p.asset_name,
                       'b3_type', p.b3_type::TEXT,
                       'quantity', p.quantity::TEXT,
                       'unit_price', p.unit_price::TEXT,
                       'fees', p.fees::TEXT,
                       'gross_amount', p.gross_amount::TEXT,
                       'tax_withheld', p.tax_withheld::TEXT,
                       'net_amount', p.net_amount::TEXT,
                       'expected_net_amount', p.expected_net_amount::TEXT,
                       'confirmed_at', p.confirmed_at,
                       'event_ratio_from', p.event_ratio_from::TEXT,
                       'event_ratio_to', p.event_ratio_to::TEXT,
                       'note', p.note,
                       'realized_exempt', r.exempt
                     )
                     ORDER BY p.trade_date DESC, p.id DESC
                   )
              FROM paged p
              LEFT JOIN realized_result r ON r.transaction_id = p.id
          ), '[]'::JSONB),
          'earlier', (
            SELECT JSONB_BUILD_OBJECT(
                     'month', TO_CHAR(b.last_date, 'YYYY-MM'),
                     'count', (
                       SELECT COUNT(*)
                         FROM UNBOUNDED u
                        WHERE TO_CHAR(u.trade_date, 'YYYY-MM') = TO_CHAR(b.last_date, 'YYYY-MM')
                          AND u.trade_date < ${filter.from}::DATE
                     )
                   )
              FROM before_period b
             WHERE b.last_date IS NOT NULL
          ),
          'recalculation', (
            SELECT JSONB_BUILD_OBJECT(
                     'pending', COUNT(*) FILTER (WHERE recalc_status IN ('queued', 'running')),
                     'failed', COUNT(*) FILTER (WHERE recalc_status = 'failed')
                   )
              FROM scope
          )
        ) AS page
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
        SELECT t.id,
               t.portfolio_id,
               t.asset_id,
               t.kind::TEXT AS kind,
               t.trade_date::TEXT AS trade_date,
               t.quantity::TEXT AS quantity,
               t.unit_price::TEXT AS unit_price,
               t.fees::TEXT AS fees,
               t.net_amount::TEXT AS net_amount,
               t.payout_kind::TEXT AS payout_kind,
               t.event_ratio_from::TEXT AS event_ratio_from,
               t.event_ratio_to::TEXT AS event_ratio_to
          FROM transaction t
          JOIN UNNEST(
                 ${sql.array(pairs.map((pair) => pair.portfolio_id))}::UUID[],
                 ${sql.array(pairs.map((pair) => pair.asset_id))}::UUID[]
               ) AS wanted(portfolio_id, asset_id)
            ON wanted.portfolio_id = t.portfolio_id
           AND wanted.asset_id = t.asset_id
         WHERE t.trade_date <= ${until}::DATE
         ORDER BY t.trade_date, t.id
      `;

      return success(rows as readonly StatementHistoryRow[]);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
