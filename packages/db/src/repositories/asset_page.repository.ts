import type {
  AssetPageFilter,
  AssetPageIdentityRow,
  AssetPagePointRow,
  AssetPagePriceRow,
  AssetPageRepository,
  AssetPageView,
} from '@patrimonio/application';
import { ASSET_PAGE_TRANSACTION_LIMIT } from '@patrimonio/application';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * T-03 · A página do ativo em duas consultas.
 *
 * Uma traz a série do gráfico, que é a única parte com milhares de linhas; a
 * outra traz tudo o resto em uma linha de JSON — posição, preço, proventos por
 * mês, lançamentos, eventos corporativos, carteiras e custódia. Duas, e não
 * sete, porque o banco fica em outra rede e o orçamento por rota (T-11) é
 * verificado por teste.
 *
 * Toda a aritmética é `numeric` do Postgres e sai daqui como `text`. É a mesma
 * regra de T-02 e pela mesma razão: `numeric(20,2)` não cabe em `double`, e um
 * centavo perdido no transporte reaparece como um resultado que não bate com a
 * corretora.
 *
 * Três decisões que parecem detalhe e não são:
 *
 * - **A série do gráfico é a ajustada por evento.** `asset_price` guarda o
 *   preço como foi negociado, que é o que todo cálculo de patrimônio usa; sem o
 *   ajuste, um desdobramento 1:2 apareceria no gráfico como uma queda de 50%
 *   que não aconteceu (M-15). O ajustado é derivado na leitura, nunca gravado.
 * - **Amortização não é rendimento.** Ela aparece como fatia própria na grade
 *   de proventos e entra no total recebido, porque é dinheiro que entrou; e
 *   fica fora do yield sobre custo e do retorno "com proventos", porque é
 *   devolução de capital e não remuneração (L-08).
 * - **Ausência não é zero.** Papel que nunca foi vendido devolve resultado
 *   realizado nulo, e não `0,00`; papel sem provento devolve yield nulo.
 */

/** A escala das razões: seis casas bastam para um percentual com duas. */
const RATIO_SCALE = 6;

/** A escala com que o preço é guardado, e com que o ajustado volta. */
const PRICE_SCALE = 8;

/** Quantos meses a grade de proventos mostra. */
const PAYOUT_MONTHS = 12;

type AggregateRow = { readonly page: AssetPageView | null };

const EMPTY_PRICE: AssetPagePriceRow = {
  value: null,
  day_change_ratio: null,
  price_health: null,
  price_date: null,
};

const EMPTY_VIEW = (asset: AssetPageIdentityRow | null): AssetPageView => ({
  asset,
  portfolio_name: null,
  as_of: null,
  computed_at: null,
  price: EMPTY_PRICE,
  position: null,
  window: {
    from: null,
    to: null,
    return_ratio: null,
    return_with_payouts_ratio: null,
    adjusted: false,
  },
  points: [],
  marks: [],
  payout_months: [],
  payouts_total_12m: '0',
  upcoming_payouts: [],
  transactions: [],
  transactions_total: 0,
  transaction_facets: [],
  corporate_events: [],
  portfolios: [],
  custodians: [],
});

/**
 * O ativo é referenciado pelo código ou pelo identificador, e a distinção é
 * feita aqui em vez de no controller: é a consulta que precisa saber em qual
 * coluna procurar, e passar as duas formas ao Postgres custaria um `cast` que
 * falha em vez de não casar.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: string): boolean => UUID.test(value);

export const createAssetPageRepository = (sql: Connection): AssetPageRepository => {
  /**
   * O recorte, compartilhado pelas duas consultas.
   *
   * `anchor` é o dia que a tela mostra: o último fechamento em ou antes de
   * hoje, ou hoje quando ainda não houve nenhum — assim a janela do gráfico
   * existe mesmo antes do primeiro fechamento, e a tela de primeiro uso mostra
   * o preço sem ter posição.
   */
  const scope = (filter: AssetPageFilter) => sql`
    WITH target AS (
      SELECT a.id AS asset_id
        FROM asset a
       WHERE (${isUuid(filter.assetId) ? filter.assetId : null}::UUID IS NOT NULL
              AND a.id = ${isUuid(filter.assetId) ? filter.assetId : null}::UUID)
          OR UPPER(a.ticker) = UPPER(${filter.assetId}::TEXT)
       LIMIT 1
    ),
    scope AS (
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
    bounds AS (
      SELECT COALESCE(
               (SELECT position_date FROM as_of),
               ${filter.today}::DATE
             ) AS anchor
    ),
    range AS (
      SELECT CASE ${filter.period}::TEXT
               WHEN '6m' THEN (b.anchor - INTERVAL '6 months')::DATE
               WHEN '1a' THEN (b.anchor - INTERVAL '12 months')::DATE
               WHEN '3a' THEN (b.anchor - INTERVAL '36 months')::DATE
             END AS from_date,
             b.anchor AS to_date
        FROM bounds b
    ),
    -- Só o evento **confirmado** ajusta: um evento ainda não confirmado não
    -- mexeu na quantidade em carteira, e ajustar por ele mostraria uma série
    -- que não corresponde a nenhuma posição.
    -- O fator na direção da exibição: um desdobramento 1:2 divide o preço
    -- anterior por dois, para o passado ficar na escala de hoje. É a mesma
    -- direção de adjustForEvents em packages/calc, e tem de ser: duas
    -- direções para a mesma série seriam dois gráficos do mesmo papel.
    events AS (
      SELECT ce.record_date, ce.ratio_from / ce.ratio_to AS factor
        FROM corporate_event ce, target t
       WHERE ce.asset_id = t.asset_id
         AND ce.confirmed_at IS NOT NULL
         AND ce.ratio_to <> ce.ratio_from
    )
  `;

  /**
   * O fator que leva o preço de uma data para a escala de hoje: o produto dos
   * fatores de todo evento posterior a ela. `numeric` não tem agregado de
   * produto, e `exp(sum(ln))` sobre `numeric` o faz com a precisão do tipo —
   * o arredondamento devolve o fator exato de um 1:2 ou de um 10:1.
   */
  const adjustment = (dateColumn: ReturnType<typeof sql>) => sql`
    LEFT JOIN LATERAL (
      SELECT ROUND(COALESCE(EXP(SUM(LN(ev.factor))), 1), ${PRICE_SCALE}) AS factor
        FROM events ev
       WHERE ev.record_date > ${dateColumn}
    ) adj ON TRUE
  `;

  return {
    open: async (filter: AssetPageFilter) => {
      try {
        const points = await sql<AssetPagePointRow[]>`
          ${scope(filter)}
          SELECT ap.price_date,
                 ap.close::TEXT AS close,
                 ROUND(ap.close * adj.factor, ${PRICE_SCALE})::TEXT AS adjusted_close
            FROM asset_price ap
            JOIN target t ON t.asset_id = ap.asset_id
           CROSS JOIN range r
           ${adjustment(sql`ap.price_date`)}
           WHERE (r.from_date IS NULL OR ap.price_date >= r.from_date)
             AND ap.price_date <= r.to_date
           ORDER BY ap.price_date
        `;

        const aggregates = await sql<AggregateRow[]>`
          ${scope(filter)},
          asset_row AS (
            SELECT a.id AS asset_id,
                   a.ticker,
                   a.name,
                   a.origin,
                   a.b3_type,
                   a.sector,
                   a.price_source,
                   a.category_id,
                   c.name AS category_name,
                   c.color_token,
                   -- "automática" é derivado, e não uma coluna: a categoria do
                   -- ativo também é a que a regra escolheria. Quem sobrescreveu
                   -- à mão vê "manual", sem um sinalizador para manter em dia.
                   (
                     c.auto_rule IS NOT NULL
                     AND (c.auto_rule->>'b3_type' IS NULL
                          OR c.auto_rule->>'b3_type' = a.b3_type)
                     AND (c.auto_rule->>'indexer' IS NULL
                          OR c.auto_rule->>'indexer' = a.indexer::TEXT)
                     AND (c.auto_rule->>'origin' IS NULL
                          OR c.auto_rule->>'origin' = a.origin::TEXT)
                     AND (c.auto_rule->>'sector' IS NULL
                          OR c.auto_rule->>'sector' = a.sector)
                   ) AS category_automatic,
                   i.name AS issuer_name,
                   a.archived_at,
                   a.indexer,
                   a.rate::TEXT AS rate,
                   a.issued_at,
                   a.maturity_date,
                   a.liquidity,
                   a.liquidity_days::INT AS liquidity_days,
                   a.tax_regime,
                   -- Título de banco marcado na curva: a quantidade dele não
                   -- diz nada a quem lê, e a tela mostra traço em vez dela.
                   CASE
                     WHEN a.origin = 'manual' AND a.indexer IS NOT NULL THEN 'curve'
                     ELSE 'quantity'
                   END AS unit
              FROM asset a
              JOIN target t ON t.asset_id = a.id
              LEFT JOIN category c ON c.id = a.category_id
              LEFT JOIN institution i ON i.id = a.issuer_id
          ),
          holdings AS (
            SELECT pd.portfolio_id,
                   s.portfolio_name,
                   pd.quantity,
                   pd.cost_basis,
                   pd.market_value,
                   pd.accrued_interest,
                   pd.price_source_kind,
                   pd.computed_at
              FROM position_daily pd
              JOIN scope s ON s.portfolio_id = pd.portfolio_id
              JOIN target t ON t.asset_id = pd.asset_id
              JOIN as_of a ON a.position_date = pd.position_date
             -- Posição zerada fica no histórico e sai da linha de posição (O-09).
             WHERE pd.quantity <> 0 OR pd.market_value <> 0
          ),
          -- O denominador do peso: tudo que o recorte tem aberto no dia, e não
          -- só este papel.
          scope_total AS (
            SELECT COALESCE(SUM(pd.market_value), 0) AS value
              FROM position_daily pd
              JOIN scope s ON s.portfolio_id = pd.portfolio_id
              JOIN as_of a ON a.position_date = pd.position_date
             WHERE pd.quantity <> 0 OR pd.market_value <> 0
          ),
          -- A janela de dez dias cobre feriado prolongado sem varrer a série:
          -- o fechamento grava todo dia útil.
          previous AS (
            SELECT COALESCE(SUM(pd.market_value), 0) AS market_value,
                   COALESCE(SUM(pd.quantity), 0) AS quantity
              FROM position_daily pd
              JOIN scope s ON s.portfolio_id = pd.portfolio_id
              JOIN target t ON t.asset_id = pd.asset_id
             WHERE pd.position_date = (
                     SELECT MAX(prev.position_date)
                       FROM position_daily prev
                       JOIN scope s2 ON s2.portfolio_id = prev.portfolio_id
                      WHERE prev.asset_id = t.asset_id
                        AND prev.position_date < (SELECT position_date FROM as_of)
                        AND prev.position_date
                              >= (SELECT position_date FROM as_of) - 10
                   )
          ),
          ledger AS (
            SELECT tr.*, s.portfolio_name
              FROM transaction tr
              JOIN scope s ON s.portfolio_id = tr.portfolio_id
              JOIN target t ON t.asset_id = tr.asset_id
          ),
          confirmed_payouts AS (
            SELECT l.*
              FROM ledger l
             WHERE l.kind = 'payout' AND l.confirmed_at IS NOT NULL
          ),
          -- Os doze meses da grade, gerados em vez de descobertos: mês sem
          -- provento é uma barra vazia, não um mês que some do eixo.
          month_axis AS (
            SELECT TO_CHAR(m, 'YYYY-MM') AS month, m::DATE AS month_start
              FROM bounds b,
                   GENERATE_SERIES(
                     DATE_TRUNC('month', b.anchor::TIMESTAMP)
                       - MAKE_INTERVAL(months => ${PAYOUT_MONTHS - 1}),
                     DATE_TRUNC('month', b.anchor::TIMESTAMP),
                     INTERVAL '1 month'
                   ) m
          ),
          payouts_by_month AS (
            SELECT TO_CHAR(p.settlement_date, 'YYYY-MM') AS month,
                   COALESCE(SUM(p.net_amount)
                     FILTER (WHERE p.payout_kind = 'dividend'), 0) AS dividend,
                   COALESCE(SUM(p.net_amount)
                     FILTER (WHERE p.payout_kind = 'jcp'), 0) AS jcp,
                   COALESCE(SUM(p.net_amount)
                     FILTER (WHERE p.payout_kind = 'income'), 0) AS income,
                   COALESCE(SUM(p.net_amount)
                     FILTER (WHERE p.payout_kind = 'interest'), 0) AS interest,
                   COALESCE(SUM(p.net_amount)
                     FILTER (WHERE p.payout_kind = 'amortization'), 0) AS amortization,
                   COALESCE(SUM(p.net_amount), 0) AS total
              FROM confirmed_payouts p
             GROUP BY 1
          ),
          payouts_12m AS (
            SELECT COALESCE(SUM(p.net_amount), 0) AS received,
                   -- Amortização reduz o custo em vez de contar como
                   -- rendimento (L-08): ela entra no recebido e sai do yield.
                   COALESCE(SUM(p.net_amount)
                     FILTER (WHERE p.payout_kind <> 'amortization'), 0) AS income
              FROM confirmed_payouts p, bounds b
             WHERE p.settlement_date <= b.anchor
               AND p.settlement_date > (b.anchor - INTERVAL '12 months')::DATE
          ),
          -- Provento por cota do período: o mesmo anúncio vira um lançamento
          -- por carteira, então a média por evento evita contá-lo duas vezes.
          payout_per_event AS (
            SELECT p.settlement_date,
                   p.trade_date,
                   AVG(p.net_amount / NULLIF(p.quantity, 0)) AS per_share
              FROM confirmed_payouts p
             CROSS JOIN range r
             WHERE p.payout_kind <> 'amortization'
               AND (r.from_date IS NULL OR p.settlement_date >= r.from_date)
               AND p.settlement_date <= r.to_date
             GROUP BY 1, 2
          ),
          window_payouts AS (
            SELECT COALESCE(SUM(e.per_share * adj.factor), 0) AS per_share
              FROM payout_per_event e
              ${adjustment(sql`e.trade_date`)}
          ),
          window_prices AS (
            SELECT (
                     SELECT ROUND(ap.close * adj.factor, ${PRICE_SCALE})
                       FROM asset_price ap
                      CROSS JOIN range r
                      ${adjustment(sql`ap.price_date`)}
                      WHERE ap.asset_id = (SELECT asset_id FROM target)
                        AND (r.from_date IS NULL OR ap.price_date >= r.from_date)
                        AND ap.price_date <= r.to_date
                      ORDER BY ap.price_date
                      LIMIT 1
                   ) AS first_close,
                   (
                     SELECT ROUND(ap.close * adj.factor, ${PRICE_SCALE})
                       FROM asset_price ap
                      CROSS JOIN range r
                      ${adjustment(sql`ap.price_date`)}
                      WHERE ap.asset_id = (SELECT asset_id FROM target)
                        AND (r.from_date IS NULL OR ap.price_date >= r.from_date)
                        AND ap.price_date <= r.to_date
                      ORDER BY ap.price_date DESC
                      LIMIT 1
                   ) AS last_close,
                   (
                     SELECT MIN(ap.price_date)
                       FROM asset_price ap, range r
                      WHERE ap.asset_id = (SELECT asset_id FROM target)
                        AND (r.from_date IS NULL OR ap.price_date >= r.from_date)
                        AND ap.price_date <= r.to_date
                   ) AS from_date,
                   (
                     SELECT MAX(ap.price_date)
                       FROM asset_price ap, range r
                      WHERE ap.asset_id = (SELECT asset_id FROM target)
                        AND (r.from_date IS NULL OR ap.price_date >= r.from_date)
                        AND ap.price_date <= r.to_date
                   ) AS to_date
          )
          SELECT JSON_BUILD_OBJECT(
            'asset', (SELECT ROW_TO_JSON(ar) FROM (
                       SELECT asset_id, ticker, name, origin, b3_type, sector,
                              price_source, category_id, category_name, color_token,
                              category_automatic, issuer_name, archived_at, indexer,
                              rate, issued_at, maturity_date, liquidity,
                              liquidity_days, tax_regime
                         FROM asset_row
                     ) ar),
            'portfolio_name', (SELECT portfolio_name FROM scope LIMIT 1),
            'as_of', (SELECT position_date FROM as_of),
            'computed_at', (SELECT MAX(computed_at) FROM holdings),
            'price', (
              SELECT JSON_BUILD_OBJECT(
                'value', CASE
                           WHEN (SELECT unit FROM asset_row) = 'quantity'
                                AND SUM(h.quantity) <> 0
                           THEN ROUND(SUM(h.market_value) / SUM(h.quantity),
                                      ${PRICE_SCALE})::TEXT
                         END,
                'day_change_ratio', ROUND(
                  (SUM(h.market_value) / NULLIF(SUM(h.quantity), 0))
                  / NULLIF(
                      (SELECT market_value / NULLIF(quantity, 0) FROM previous), 0
                    ) - 1,
                  ${RATIO_SCALE}
                )::TEXT,
                -- A ressalva do recorte é a pior das linhas: uma carteira com
                -- preço de ontem contamina o total mesmo que a outra esteja em
                -- dia, e dizer "fresh" aí seria dizer que o número é de hoje.
                'price_health', (
                  SELECT h2.price_source_kind
                    FROM holdings h2
                   ORDER BY CASE h2.price_source_kind
                              WHEN 'missing' THEN 0 WHEN 'stale' THEN 1
                              WHEN 'manual' THEN 2 ELSE 3
                            END
                   LIMIT 1
                ),
                'price_date', (
                  SELECT CASE
                           WHEN (SELECT price_source_kind FROM holdings
                                  ORDER BY CASE price_source_kind
                                             WHEN 'manual' THEN 0 ELSE 1 END
                                  LIMIT 1) = 'manual'
                           THEN (SELECT MAX(mp.price_date) FROM manual_price mp
                                  WHERE mp.asset_id = (SELECT asset_id FROM target)
                                    AND mp.price_date <= b.anchor)
                           ELSE (SELECT MAX(ap.price_date) FROM asset_price ap
                                  WHERE ap.asset_id = (SELECT asset_id FROM target)
                                    AND ap.price_date <= b.anchor)
                         END
                    FROM bounds b
                )
              )
              FROM holdings h
            ),
            'position', (
              SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE JSON_BUILD_OBJECT(
                'unit', (SELECT unit FROM asset_row),
                'quantity', CASE
                              WHEN (SELECT unit FROM asset_row) = 'quantity'
                              THEN SUM(h.quantity)::TEXT
                            END,
                -- Com mais de uma carteira no recorte, o preço médio exibido é
                -- custo sobre quantidade: a média ponderada das duas pontas. O
                -- preço médio do modelo continua sendo por carteira (C-01).
                'avg_price', CASE
                               WHEN (SELECT unit FROM asset_row) = 'quantity'
                                    AND SUM(h.quantity) <> 0
                               THEN ROUND(SUM(h.cost_basis) / SUM(h.quantity),
                                          ${PRICE_SCALE})::TEXT
                             END,
                'cost_basis', SUM(h.cost_basis)::TEXT,
                'value', SUM(h.market_value)::TEXT,
                'open_result', SUM(h.market_value - h.cost_basis)::TEXT,
                'open_result_ratio', ROUND(
                  SUM(h.market_value - h.cost_basis) / NULLIF(SUM(h.cost_basis), 0),
                  ${RATIO_SCALE}
                )::TEXT,
                'weight', COALESCE(ROUND(
                  SUM(h.market_value) / NULLIF((SELECT value FROM scope_total), 0),
                  ${RATIO_SCALE}
                ), 0)::TEXT,
                'accrued_interest', COALESCE(SUM(h.accrued_interest), 0)::TEXT,
                -- Nunca vendido é ausência de resultado realizado, não zero:
                -- "0,00" leria como "vendi e não ganhei nada".
                'realized_result', (
                  SELECT SUM(rr.result)::TEXT
                    FROM realized_result rr
                    JOIN scope s ON s.portfolio_id = rr.portfolio_id
                   WHERE rr.asset_id = (SELECT asset_id FROM target)
                ),
                'payouts_12m', (SELECT received FROM payouts_12m)::TEXT,
                'yield_on_cost_12m', ROUND(
                  NULLIF((SELECT income FROM payouts_12m), 0)
                    / NULLIF(SUM(h.cost_basis), 0),
                  ${RATIO_SCALE}
                )::TEXT
              ) END
              FROM holdings h
            ),
            'window', (
              SELECT JSON_BUILD_OBJECT(
                'from', w.from_date,
                'to', w.to_date,
                'return_ratio', ROUND(
                  w.last_close / NULLIF(w.first_close, 0) - 1, ${RATIO_SCALE}
                )::TEXT,
                'return_with_payouts_ratio', ROUND(
                  (w.last_close + (SELECT per_share FROM window_payouts))
                    / NULLIF(w.first_close, 0) - 1,
                  ${RATIO_SCALE}
                )::TEXT,
                'adjusted', EXISTS (
                  SELECT 1 FROM events e, range r
                   WHERE e.record_date <= r.to_date
                     AND (r.from_date IS NULL OR e.record_date >= r.from_date)
                )
              )
              FROM window_prices w
            ),
            'marks', COALESCE((
              SELECT JSON_AGG(m ORDER BY m.trade_date)
                FROM (
                  SELECT l.trade_date,
                         l.kind::TEXT AS side,
                         SUM(l.quantity)::TEXT AS quantity,
                         ROUND(
                           SUM(l.quantity * l.unit_price) / NULLIF(SUM(l.quantity), 0),
                           ${PRICE_SCALE}
                         )::TEXT AS unit_price
                    FROM ledger l
                   CROSS JOIN range r
                   WHERE l.kind IN ('buy', 'sell')
                     AND l.quantity > 0
                     AND (r.from_date IS NULL OR l.trade_date >= r.from_date)
                     AND l.trade_date <= r.to_date
                   GROUP BY l.trade_date, l.kind
                ) m
            ), '[]'::JSON),
            'payout_months', COALESCE((
              SELECT JSON_AGG(
                       JSON_BUILD_OBJECT(
                         'month', a.month,
                         'dividend', COALESCE(p.dividend, 0)::TEXT,
                         'jcp', COALESCE(p.jcp, 0)::TEXT,
                         'income', COALESCE(p.income, 0)::TEXT,
                         'interest', COALESCE(p.interest, 0)::TEXT,
                         'amortization', COALESCE(p.amortization, 0)::TEXT,
                         'total', COALESCE(p.total, 0)::TEXT
                       )
                       ORDER BY a.month
                     )
                FROM month_axis a
                LEFT JOIN payouts_by_month p ON p.month = a.month
            ), '[]'::JSON),
            'payouts_total_12m', (SELECT received FROM payouts_12m)::TEXT,
            'upcoming_payouts', COALESCE((
              SELECT JSON_AGG(
                       JSON_BUILD_OBJECT(
                         'transaction_id', l.id,
                         'settlement_date', l.settlement_date,
                         'payout_kind', l.payout_kind,
                         'net_amount', l.net_amount::TEXT
                       )
                       ORDER BY l.settlement_date
                     )
                FROM ledger l
               WHERE l.kind = 'payout' AND l.confirmed_at IS NULL
            ), '[]'::JSON),
            'transactions', COALESCE((
              SELECT JSON_AGG(t ORDER BY t.trade_date DESC, t.created_at DESC)
                FROM (
                  SELECT l.id,
                         l.kind,
                         l.payout_kind,
                         l.trade_date,
                         l.settlement_date,
                         l.quantity::TEXT AS quantity,
                         l.unit_price::TEXT AS unit_price,
                         l.net_amount::TEXT AS net_amount,
                         l.confirmed_at,
                         l.portfolio_id,
                         l.portfolio_name,
                         i.name AS institution_name,
                         l.created_at
                    FROM ledger l
                    LEFT JOIN institution i ON i.id = l.institution_id
                   WHERE (${filter.kind}::TEXT IS NULL
                          OR l.kind::TEXT = ${filter.kind}::TEXT)
                   ORDER BY l.trade_date DESC, l.created_at DESC
                   LIMIT ${ASSET_PAGE_TRANSACTION_LIMIT}
                ) t
            ), '[]'::JSON),
            'transactions_total', (
              SELECT COUNT(*)::INT FROM ledger l
               WHERE (${filter.kind}::TEXT IS NULL
                      OR l.kind::TEXT = ${filter.kind}::TEXT)
            ),
            -- As contagens são de antes do filtro de tipo: é o que faz a opção
            -- "Compra 12" continuar dizendo 12 depois de ser escolhida.
            'transaction_facets', COALESCE((
              SELECT JSON_AGG(
                       JSON_BUILD_OBJECT('kind', f.kind, 'count', f.count)
                       ORDER BY f.count DESC, f.kind
                     )
                FROM (
                  SELECT l.kind, COUNT(*)::INT AS count FROM ledger l GROUP BY l.kind
                ) f
            ), '[]'::JSON),
            'corporate_events', COALESCE((
              SELECT JSON_AGG(
                       JSON_BUILD_OBJECT(
                         'id', ce.id,
                         'kind', ce.kind,
                         'record_date', ce.record_date,
                         'ratio_from', ce.ratio_from::TEXT,
                         'ratio_to', ce.ratio_to::TEXT,
                         'confirmed_at', ce.confirmed_at
                       )
                       ORDER BY ce.record_date DESC
                     )
                FROM corporate_event ce
               WHERE ce.asset_id = (SELECT asset_id FROM target)
            ), '[]'::JSON),
            'portfolios', COALESCE((
              SELECT JSON_AGG(
                       JSON_BUILD_OBJECT(
                         'portfolio_id', h.portfolio_id,
                         'portfolio_name', h.portfolio_name,
                         'quantity', CASE
                                       WHEN (SELECT unit FROM asset_row) = 'quantity'
                                       THEN h.quantity::TEXT
                                     END,
                         'value', h.market_value::TEXT
                       )
                       ORDER BY h.market_value DESC
                     )
                FROM holdings h
            ), '[]'::JSON),
            'custodians', COALESCE((
              SELECT JSON_AGG(
                       JSON_BUILD_OBJECT(
                         'institution_id', c.institution_id,
                         'institution_name', c.institution_name
                       )
                       ORDER BY c.institution_name
                     )
                FROM (
                  SELECT DISTINCT l.institution_id, i.name AS institution_name
                    FROM ledger l
                    JOIN institution i ON i.id = l.institution_id
                ) c
            ), '[]'::JSON)
          ) AS page
        `;

        const page = aggregates[0]?.page ?? null;

        // Ativo inexistente sai daqui como `asset` nulo, e o caso de uso o
        // transforma em 404. Um endereço velho colado de um favorito precisa
        // dizer que o papel não existe, e não parecer um papel sem histórico.
        if (page === null || page.asset === null) return success(EMPTY_VIEW(null));

        return success({
          ...page,
          points,
          price: page.price ?? EMPTY_PRICE,
        } satisfies AssetPageView);
      } catch (error) {
        return failure(getRepositoryError(error));
      }
    },
  };
};
