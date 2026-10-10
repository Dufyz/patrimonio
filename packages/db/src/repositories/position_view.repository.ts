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
      WITH scope AS (
        SELECT p.id AS portfolio_id, p.name AS portfolio_name
          FROM portfolio p
         WHERE p.archived_at IS NULL
           AND p.id = ${filter.portfolioId}::UUID
      ),
      as_of AS (
        SELECT MAX(pd.position_date) AS position_date
          FROM position_daily pd
          JOIN scope s ON s.portfolio_id = pd.portfolio_id
         WHERE pd.position_date <= ${filter.today}::DATE
      ),
      -- Posição zerada fica no histórico e sai de Posições (O-09).
      open_positions AS (
        SELECT pd.portfolio_id,
               pd.asset_id,
               pd.quantity,
               pd.avg_price,
               pd.cost_basis,
               pd.market_value,
               pd.price_source_kind,
               pd.computed_at,
               pd.position_date
          FROM position_daily pd
          JOIN scope s ON s.portfolio_id = pd.portfolio_id
          JOIN as_of a ON a.position_date = pd.position_date
         WHERE pd.quantity <> 0 OR pd.market_value <> 0
      ),
      -- Onde o papel está custodiado: a instituição do lançamento mais recente
      -- daquela carteira para aquele ativo. A projeção não tem a coluna,
      -- e não deveria ter: custódia é fato do livro, não da projeção.
      custodian AS (
        SELECT DISTINCT ON (t.portfolio_id, t.asset_id)
               t.portfolio_id,
               t.asset_id,
               t.institution_id,
               i.name AS institution_name
          FROM transaction t
          JOIN scope s ON s.portfolio_id = t.portfolio_id
          JOIN institution i ON i.id = t.institution_id
         WHERE t.asset_id IS NOT NULL
         ORDER BY t.portfolio_id, t.asset_id, t.trade_date DESC, t.created_at DESC
      ),
      decorated AS (
        SELECT op.portfolio_id,
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
               c.name AS category_name,
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
               CASE
                 WHEN a.origin = 'manual' AND a.indexer IS NOT NULL THEN 'curve'
                 ELSE 'quantity'
               END AS unit,
               CASE
                 WHEN op.quantity <> 0 THEN op.market_value / op.quantity
               END AS unit_value,
               previous.unit_value AS previous_unit_value,
               year_ago.unit_value AS year_ago_unit_value,
               COALESCE(payouts.amount, 0) AS payouts_12m,
               CASE
                 WHEN op.price_source_kind = 'manual' THEN (
                   SELECT MAX(mp.price_date)
                     FROM manual_price mp
                    WHERE mp.asset_id = op.asset_id
                      AND mp.price_date <= op.position_date
                 )
                 ELSE (
                   SELECT MAX(ap.price_date)
                     FROM asset_price ap
                    WHERE ap.asset_id = op.asset_id
                      AND ap.price_date <= op.position_date
                 )
               END AS price_date
          FROM open_positions op
          JOIN scope s ON s.portfolio_id = op.portfolio_id
          JOIN asset a ON a.id = op.asset_id
          LEFT JOIN category c ON c.id = a.category_id
          LEFT JOIN custodian cu
            ON cu.portfolio_id = op.portfolio_id
           AND cu.asset_id = op.asset_id
          -- A janela de dez dias cobre feriado prolongado sem varrer a série
          -- inteira: o fechamento grava todo dia útil, então o anterior está
          -- sempre dentro dela.
          LEFT JOIN LATERAL (
            SELECT CASE WHEN p.quantity <> 0 THEN p.market_value / p.quantity END
                     AS unit_value
              FROM position_daily p
             WHERE p.portfolio_id = op.portfolio_id
               AND p.asset_id = op.asset_id
               AND p.position_date < op.position_date
               AND p.position_date >= op.position_date - 10
             ORDER BY p.position_date DESC
             LIMIT 1
          ) previous ON TRUE
          LEFT JOIN LATERAL (
            SELECT CASE WHEN p.quantity <> 0 THEN p.market_value / p.quantity END
                     AS unit_value
              FROM position_daily p
             WHERE p.portfolio_id = op.portfolio_id
               AND p.asset_id = op.asset_id
               AND p.position_date <= (op.position_date - INTERVAL '12 months')::DATE
               AND p.position_date
                     >= (op.position_date - INTERVAL '12 months')::DATE - 10
             ORDER BY p.position_date DESC
             LIMIT 1
          ) year_ago ON TRUE
          LEFT JOIN LATERAL (
            SELECT SUM(t.net_amount) AS amount
              FROM transaction t
             WHERE t.portfolio_id = op.portfolio_id
               AND t.asset_id = op.asset_id
               AND t.kind = 'payout'
               AND t.confirmed_at IS NOT NULL
               AND t.settlement_date <= op.position_date
               AND t.settlement_date > (op.position_date - INTERVAL '12 months')::DATE
          ) payouts ON TRUE
      ),
      searched AS (
        SELECT *
          FROM decorated d
         WHERE ${
           search === null
             ? sql`TRUE`
             : sql`(d.ticker ILIKE ${search} OR d.name ILIKE ${search})`
         }
      ),
      filtered AS (
        SELECT *
          FROM searched f
         WHERE ${
           category === null
             ? sql`TRUE`
             : category === 'sem-categoria'
               ? sql`f.category_id IS NULL`
               : sql`f.category_id = ${category}::UUID`
         }
      ),
      grouped AS (
        SELECT f.*,
               CASE ${filter.groupBy}::TEXT
                 WHEN 'category'
                   THEN COALESCE(f.category_id::TEXT, 'sem-categoria')
                 WHEN 'institution'
                   THEN COALESCE(f.institution_id::TEXT, 'sem-instituicao')
                 ELSE 'sem-grupo'
               END AS group_key,
               CASE ${filter.groupBy}::TEXT
                 WHEN 'category' THEN COALESCE(f.category_name, 'Sem categoria')
                 WHEN 'institution'
                   THEN COALESCE(f.institution_name, 'Sem instituição')
                 ELSE 'Posições'
               END AS group_label,
               CASE
                 WHEN ${filter.groupBy}::TEXT = 'category' THEN f.color_token
               END AS group_color_token,
               SUM(f.market_value) OVER () AS scope_value
          FROM filtered f
      )
    `;
  };

  return {
    open: async (filter: PositionViewFilter) => {
      try {
        const rows = await sql<PositionViewRow[]>`
          ${scope(filter)}
          SELECT g.group_key,
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
                 CASE WHEN g.unit = 'quantity' THEN g.quantity::TEXT END AS quantity,
                 CASE WHEN g.unit = 'quantity' THEN g.avg_price::TEXT END AS avg_price,
                 CASE
                   WHEN g.unit = 'quantity'
                   THEN ROUND(g.unit_value, ${PRICE_SCALE})::TEXT
                 END AS price,
                 g.price_source_kind AS price_health,
                 g.price_date,
                 g.market_value::TEXT AS value,
                 g.cost_basis::TEXT AS cost_basis,
                 (g.market_value - g.cost_basis)::TEXT AS open_result,
                 ROUND(
                   (g.market_value - g.cost_basis) / NULLIF(g.cost_basis, 0),
                   ${RATIO_SCALE}
                 )::TEXT AS open_result_ratio,
                 ROUND(
                   g.market_value / NULLIF(g.scope_value, 0),
                   ${RATIO_SCALE}
                 )::TEXT AS weight,
                 ROUND(
                   g.unit_value / NULLIF(g.previous_unit_value, 0) - 1,
                   ${RATIO_SCALE}
                 )::TEXT AS day_change_ratio,
                 ROUND(
                   g.unit_value / NULLIF(g.year_ago_unit_value, 0) - 1,
                   ${RATIO_SCALE}
                 )::TEXT AS return_12m_ratio,
                 -- Nenhum provento em doze meses é ausência de provento, e
                 -- não rendimento de zero por cento: a tela mostra o detalhe
                 -- do papel em vez de um "DY 0,0%" que não quer dizer nada.
                 ROUND(
                   NULLIF(g.payouts_12m, 0) / NULLIF(g.market_value, 0),
                   ${RATIO_SCALE}
                 )::TEXT AS dividend_yield_12m,
                 g.indexer,
                 g.rate::TEXT AS rate,
                 g.maturity_date
            FROM grouped g
           ORDER BY SUM(g.market_value) OVER (PARTITION BY g.group_key) DESC,
                    g.group_key,
                    g.market_value DESC,
                    g.ticker
        `;

        const aggregates = await sql<AggregateRow[]>`
          ${scope(filter)},
          summaries AS (
            SELECT g.group_key,
                   COUNT(*)::INT AS count,
                   COALESCE(SUM(g.market_value), 0)::TEXT AS value,
                   COALESCE(SUM(g.cost_basis), 0)::TEXT AS cost_basis,
                   COALESCE(SUM(g.market_value - g.cost_basis), 0)::TEXT AS open_result,
                   ROUND(
                     SUM(g.market_value - g.cost_basis) / NULLIF(SUM(g.cost_basis), 0),
                     ${RATIO_SCALE}
                   )::TEXT AS open_result_ratio,
                   ROUND(
                     COALESCE(SUM(g.market_value), 0) / NULLIF(MAX(g.scope_value), 0),
                     ${RATIO_SCALE}
                   )::TEXT AS weight,
                   -- O total geral vem do mesmo lugar que os subtotais, para
                   -- não haver dois caminhos somando o mesmo dinheiro.
                   GROUPING(g.group_key) AS is_total
              FROM grouped g
             GROUP BY GROUPING SETS ((g.group_key), ())
          ),
          facets AS (
            SELECT COALESCE(s.category_id::TEXT, 'sem-categoria') AS id,
                   COALESCE(s.category_name, 'Sem categoria') AS label,
                   s.color_token,
                   COUNT(*)::INT AS count,
                   SUM(s.market_value) AS value
              FROM searched s
             GROUP BY 1, 2, 3
          ),
          quota AS (
            SELECT pd.position_date, pd.quota_value
              FROM portfolio_daily pd
             WHERE pd.portfolio_id = ${filter.portfolioId}::UUID
               AND pd.position_date <= (SELECT position_date FROM as_of)
          ),
          header AS (
            SELECT (SELECT position_date FROM as_of) AS as_of,
                   (SELECT MAX(computed_at) FROM open_positions) AS computed_at,
                   COALESCE((
                     SELECT SUM(t.net_amount)
                       FROM transaction t
                       JOIN scope s ON s.portfolio_id = t.portfolio_id
                      WHERE t.kind = 'payout'
                        AND t.confirmed_at IS NOT NULL
                        AND t.settlement_date <= (SELECT position_date FROM as_of)
                        AND t.settlement_date
                              > ((SELECT position_date FROM as_of)
                                 - INTERVAL '12 months')::DATE
                   ), 0)::TEXT AS payouts_12m,
                   ROUND(
                     (SELECT quota_value FROM quota ORDER BY position_date DESC LIMIT 1)
                     / NULLIF((
                         SELECT quota_value FROM quota
                          WHERE position_date < (SELECT position_date FROM as_of)
                          ORDER BY position_date DESC LIMIT 1
                       ), 0) - 1,
                     ${RATIO_SCALE}
                   )::TEXT AS day_change_ratio,
                   ROUND(
                     (SELECT quota_value FROM quota ORDER BY position_date DESC LIMIT 1)
                     / NULLIF((
                         SELECT quota_value FROM quota
                          WHERE position_date
                                  <= ((SELECT position_date FROM as_of)
                                      - INTERVAL '12 months')::DATE
                          ORDER BY position_date DESC LIMIT 1
                       ), 0) - 1,
                     ${RATIO_SCALE}
                   )::TEXT AS return_12m_ratio,
                   COUNT(*) FILTER (WHERE o.price_source_kind = 'fresh')::INT AS fresh,
                   COUNT(*) FILTER (WHERE o.price_source_kind = 'stale')::INT AS stale,
                   COUNT(*) FILTER (WHERE o.price_source_kind = 'manual')::INT AS manual,
                   COUNT(*) FILTER (WHERE o.price_source_kind = 'missing')::INT
                     AS missing
              FROM open_positions o
          )
          SELECT (
                   SELECT JSON_AGG(
                            JSON_BUILD_OBJECT(
                              'group_key', CASE WHEN s.is_total = 1 THEN NULL
                                                ELSE s.group_key END,
                              'count', s.count,
                              'value', s.value,
                              'cost_basis', s.cost_basis,
                              'open_result', s.open_result,
                              'open_result_ratio', s.open_result_ratio,
                              'weight', COALESCE(s.weight, '0')
                            )
                          )
                     FROM summaries s
                 ) AS summaries,
                 (
                   SELECT JSON_AGG(
                            JSON_BUILD_OBJECT(
                              'id', f.id,
                              'label', f.label,
                              'color_token', f.color_token,
                              'count', f.count
                            )
                            ORDER BY f.value DESC
                          )
                     FROM facets f
                 ) AS facets,
                 (SELECT ROW_TO_JSON(h) FROM header h) AS header
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
