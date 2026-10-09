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
    with target as (
      select a.id as asset_id
        from asset a
       where (${isUuid(filter.assetId) ? filter.assetId : null}::uuid is not null
              and a.id = ${isUuid(filter.assetId) ? filter.assetId : null}::uuid)
          or upper(a.ticker) = upper(${filter.assetId}::text)
       limit 1
    ),
    scope as (
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
    bounds as (
      select coalesce(
               (select position_date from as_of),
               ${filter.today}::date
             ) as anchor
    ),
    range as (
      select case ${filter.period}::text
               when '6m' then (b.anchor - interval '6 months')::date
               when '1a' then (b.anchor - interval '12 months')::date
               when '3a' then (b.anchor - interval '36 months')::date
             end as from_date,
             b.anchor as to_date
        from bounds b
    ),
    -- Só o evento **confirmado** ajusta: um evento ainda não confirmado não
    -- mexeu na quantidade em carteira, e ajustar por ele mostraria uma série
    -- que não corresponde a nenhuma posição.
    -- O fator na direção da exibição: um desdobramento 1:2 divide o preço
    -- anterior por dois, para o passado ficar na escala de hoje. É a mesma
    -- direção de adjustForEvents em packages/calc, e tem de ser: duas
    -- direções para a mesma série seriam dois gráficos do mesmo papel.
    events as (
      select ce.record_date, ce.ratio_from / ce.ratio_to as factor
        from corporate_event ce, target t
       where ce.asset_id = t.asset_id
         and ce.confirmed_at is not null
         and ce.ratio_to <> ce.ratio_from
    )
  `;

  /**
   * O fator que leva o preço de uma data para a escala de hoje: o produto dos
   * fatores de todo evento posterior a ela. `numeric` não tem agregado de
   * produto, e `exp(sum(ln))` sobre `numeric` o faz com a precisão do tipo —
   * o arredondamento devolve o fator exato de um 1:2 ou de um 10:1.
   */
  const adjustment = (dateColumn: ReturnType<typeof sql>) => sql`
    left join lateral (
      select round(coalesce(exp(sum(ln(ev.factor))), 1), ${PRICE_SCALE}) as factor
        from events ev
       where ev.record_date > ${dateColumn}
    ) adj on true
  `;

  return {
    open: async (filter: AssetPageFilter) => {
      try {
        const points = await sql<AssetPagePointRow[]>`
          ${scope(filter)}
          select ap.price_date,
                 ap.close::text as close,
                 round(ap.close * adj.factor, ${PRICE_SCALE})::text as adjusted_close
            from asset_price ap
            join target t on t.asset_id = ap.asset_id
           cross join range r
           ${adjustment(sql`ap.price_date`)}
           where (r.from_date is null or ap.price_date >= r.from_date)
             and ap.price_date <= r.to_date
           order by ap.price_date
        `;

        const aggregates = await sql<AggregateRow[]>`
          ${scope(filter)},
          asset_row as (
            select a.id as asset_id,
                   a.ticker,
                   a.name,
                   a.origin,
                   a.b3_type,
                   a.sector,
                   a.price_source,
                   a.category_id,
                   c.name as category_name,
                   c.color_token,
                   -- "automática" é derivado, e não uma coluna: a categoria do
                   -- ativo também é a que a regra escolheria. Quem sobrescreveu
                   -- à mão vê "manual", sem um sinalizador para manter em dia.
                   (
                     c.auto_rule is not null
                     and (c.auto_rule->>'b3_type' is null
                          or c.auto_rule->>'b3_type' = a.b3_type)
                     and (c.auto_rule->>'indexer' is null
                          or c.auto_rule->>'indexer' = a.indexer::text)
                     and (c.auto_rule->>'origin' is null
                          or c.auto_rule->>'origin' = a.origin::text)
                     and (c.auto_rule->>'sector' is null
                          or c.auto_rule->>'sector' = a.sector)
                   ) as category_automatic,
                   i.name as issuer_name,
                   a.archived_at,
                   a.indexer,
                   a.rate::text as rate,
                   a.issued_at,
                   a.maturity_date,
                   a.liquidity,
                   a.liquidity_days::int as liquidity_days,
                   a.tax_regime,
                   -- Título de banco marcado na curva: a quantidade dele não
                   -- diz nada a quem lê, e a tela mostra traço em vez dela.
                   case
                     when a.origin = 'manual' and a.indexer is not null then 'curve'
                     else 'quantity'
                   end as unit
              from asset a
              join target t on t.asset_id = a.id
              left join category c on c.id = a.category_id
              left join institution i on i.id = a.issuer_id
          ),
          holdings as (
            select pd.portfolio_id,
                   s.portfolio_name,
                   pd.quantity,
                   pd.cost_basis,
                   pd.market_value,
                   pd.accrued_interest,
                   pd.price_source_kind,
                   pd.computed_at
              from position_daily pd
              join scope s on s.portfolio_id = pd.portfolio_id
              join target t on t.asset_id = pd.asset_id
              join as_of a on a.position_date = pd.position_date
             -- Posição zerada fica no histórico e sai da linha de posição (O-09).
             where pd.quantity <> 0 or pd.market_value <> 0
          ),
          -- O denominador do peso: tudo que o recorte tem aberto no dia, e não
          -- só este papel.
          scope_total as (
            select coalesce(sum(pd.market_value), 0) as value
              from position_daily pd
              join scope s on s.portfolio_id = pd.portfolio_id
              join as_of a on a.position_date = pd.position_date
             where pd.quantity <> 0 or pd.market_value <> 0
          ),
          -- A janela de dez dias cobre feriado prolongado sem varrer a série:
          -- o fechamento grava todo dia útil.
          previous as (
            select coalesce(sum(pd.market_value), 0) as market_value,
                   coalesce(sum(pd.quantity), 0) as quantity
              from position_daily pd
              join scope s on s.portfolio_id = pd.portfolio_id
              join target t on t.asset_id = pd.asset_id
             where pd.position_date = (
                     select max(prev.position_date)
                       from position_daily prev
                       join scope s2 on s2.portfolio_id = prev.portfolio_id
                      where prev.asset_id = t.asset_id
                        and prev.position_date < (select position_date from as_of)
                        and prev.position_date
                              >= (select position_date from as_of) - 10
                   )
          ),
          ledger as (
            select tr.*, s.portfolio_name
              from transaction tr
              join scope s on s.portfolio_id = tr.portfolio_id
              join target t on t.asset_id = tr.asset_id
          ),
          confirmed_payouts as (
            select l.*
              from ledger l
             where l.kind = 'payout' and l.confirmed_at is not null
          ),
          -- Os doze meses da grade, gerados em vez de descobertos: mês sem
          -- provento é uma barra vazia, não um mês que some do eixo.
          month_axis as (
            select to_char(m, 'YYYY-MM') as month, m::date as month_start
              from bounds b,
                   generate_series(
                     date_trunc('month', b.anchor::timestamp)
                       - make_interval(months => ${PAYOUT_MONTHS - 1}),
                     date_trunc('month', b.anchor::timestamp),
                     interval '1 month'
                   ) m
          ),
          payouts_by_month as (
            select to_char(p.settlement_date, 'YYYY-MM') as month,
                   coalesce(sum(p.net_amount)
                     filter (where p.payout_kind = 'dividend'), 0) as dividend,
                   coalesce(sum(p.net_amount)
                     filter (where p.payout_kind = 'jcp'), 0) as jcp,
                   coalesce(sum(p.net_amount)
                     filter (where p.payout_kind = 'income'), 0) as income,
                   coalesce(sum(p.net_amount)
                     filter (where p.payout_kind = 'interest'), 0) as interest,
                   coalesce(sum(p.net_amount)
                     filter (where p.payout_kind = 'amortization'), 0) as amortization,
                   coalesce(sum(p.net_amount), 0) as total
              from confirmed_payouts p
             group by 1
          ),
          payouts_12m as (
            select coalesce(sum(p.net_amount), 0) as received,
                   -- Amortização reduz o custo em vez de contar como
                   -- rendimento (L-08): ela entra no recebido e sai do yield.
                   coalesce(sum(p.net_amount)
                     filter (where p.payout_kind <> 'amortization'), 0) as income
              from confirmed_payouts p, bounds b
             where p.settlement_date <= b.anchor
               and p.settlement_date > (b.anchor - interval '12 months')::date
          ),
          -- Provento por cota do período: o mesmo anúncio vira um lançamento
          -- por carteira, então a média por evento evita contá-lo duas vezes.
          payout_per_event as (
            select p.settlement_date,
                   p.trade_date,
                   avg(p.net_amount / nullif(p.quantity, 0)) as per_share
              from confirmed_payouts p
             cross join range r
             where p.payout_kind <> 'amortization'
               and (r.from_date is null or p.settlement_date >= r.from_date)
               and p.settlement_date <= r.to_date
             group by 1, 2
          ),
          window_payouts as (
            select coalesce(sum(e.per_share * adj.factor), 0) as per_share
              from payout_per_event e
              ${adjustment(sql`e.trade_date`)}
          ),
          window_prices as (
            select (
                     select round(ap.close * adj.factor, ${PRICE_SCALE})
                       from asset_price ap
                      cross join range r
                      ${adjustment(sql`ap.price_date`)}
                      where ap.asset_id = (select asset_id from target)
                        and (r.from_date is null or ap.price_date >= r.from_date)
                        and ap.price_date <= r.to_date
                      order by ap.price_date
                      limit 1
                   ) as first_close,
                   (
                     select round(ap.close * adj.factor, ${PRICE_SCALE})
                       from asset_price ap
                      cross join range r
                      ${adjustment(sql`ap.price_date`)}
                      where ap.asset_id = (select asset_id from target)
                        and (r.from_date is null or ap.price_date >= r.from_date)
                        and ap.price_date <= r.to_date
                      order by ap.price_date desc
                      limit 1
                   ) as last_close,
                   (
                     select min(ap.price_date)
                       from asset_price ap, range r
                      where ap.asset_id = (select asset_id from target)
                        and (r.from_date is null or ap.price_date >= r.from_date)
                        and ap.price_date <= r.to_date
                   ) as from_date,
                   (
                     select max(ap.price_date)
                       from asset_price ap, range r
                      where ap.asset_id = (select asset_id from target)
                        and (r.from_date is null or ap.price_date >= r.from_date)
                        and ap.price_date <= r.to_date
                   ) as to_date
          )
          select json_build_object(
            'asset', (select row_to_json(ar) from (
                       select asset_id, ticker, name, origin, b3_type, sector,
                              price_source, category_id, category_name, color_token,
                              category_automatic, issuer_name, archived_at, indexer,
                              rate, issued_at, maturity_date, liquidity,
                              liquidity_days, tax_regime
                         from asset_row
                     ) ar),
            'portfolio_name', (select portfolio_name from scope
                                where ${filter.portfolioId}::uuid is not null limit 1),
            'as_of', (select position_date from as_of),
            'computed_at', (select max(computed_at) from holdings),
            'price', (
              select json_build_object(
                'value', case
                           when (select unit from asset_row) = 'quantity'
                                and sum(h.quantity) <> 0
                           then round(sum(h.market_value) / sum(h.quantity),
                                      ${PRICE_SCALE})::text
                         end,
                'day_change_ratio', round(
                  (sum(h.market_value) / nullif(sum(h.quantity), 0))
                  / nullif(
                      (select market_value / nullif(quantity, 0) from previous), 0
                    ) - 1,
                  ${RATIO_SCALE}
                )::text,
                -- A ressalva do recorte é a pior das linhas: uma carteira com
                -- preço de ontem contamina o total mesmo que a outra esteja em
                -- dia, e dizer "fresh" aí seria dizer que o número é de hoje.
                'price_health', (
                  select h2.price_source_kind
                    from holdings h2
                   order by case h2.price_source_kind
                              when 'missing' then 0 when 'stale' then 1
                              when 'manual' then 2 else 3
                            end
                   limit 1
                ),
                'price_date', (
                  select case
                           when (select price_source_kind from holdings
                                  order by case price_source_kind
                                             when 'manual' then 0 else 1 end
                                  limit 1) = 'manual'
                           then (select max(mp.price_date) from manual_price mp
                                  where mp.asset_id = (select asset_id from target)
                                    and mp.price_date <= b.anchor)
                           else (select max(ap.price_date) from asset_price ap
                                  where ap.asset_id = (select asset_id from target)
                                    and ap.price_date <= b.anchor)
                         end
                    from bounds b
                )
              )
              from holdings h
            ),
            'position', (
              select case when count(*) = 0 then null else json_build_object(
                'unit', (select unit from asset_row),
                'quantity', case
                              when (select unit from asset_row) = 'quantity'
                              then sum(h.quantity)::text
                            end,
                -- Com mais de uma carteira no recorte, o preço médio exibido é
                -- custo sobre quantidade: a média ponderada das duas pontas. O
                -- preço médio do modelo continua sendo por carteira (C-01).
                'avg_price', case
                               when (select unit from asset_row) = 'quantity'
                                    and sum(h.quantity) <> 0
                               then round(sum(h.cost_basis) / sum(h.quantity),
                                          ${PRICE_SCALE})::text
                             end,
                'cost_basis', sum(h.cost_basis)::text,
                'value', sum(h.market_value)::text,
                'open_result', sum(h.market_value - h.cost_basis)::text,
                'open_result_ratio', round(
                  sum(h.market_value - h.cost_basis) / nullif(sum(h.cost_basis), 0),
                  ${RATIO_SCALE}
                )::text,
                'weight', coalesce(round(
                  sum(h.market_value) / nullif((select value from scope_total), 0),
                  ${RATIO_SCALE}
                ), 0)::text,
                'accrued_interest', coalesce(sum(h.accrued_interest), 0)::text,
                -- Nunca vendido é ausência de resultado realizado, não zero:
                -- "0,00" leria como "vendi e não ganhei nada".
                'realized_result', (
                  select sum(rr.result)::text
                    from realized_result rr
                    join scope s on s.portfolio_id = rr.portfolio_id
                   where rr.asset_id = (select asset_id from target)
                ),
                'payouts_12m', (select received from payouts_12m)::text,
                'yield_on_cost_12m', round(
                  nullif((select income from payouts_12m), 0)
                    / nullif(sum(h.cost_basis), 0),
                  ${RATIO_SCALE}
                )::text
              ) end
              from holdings h
            ),
            'window', (
              select json_build_object(
                'from', w.from_date,
                'to', w.to_date,
                'return_ratio', round(
                  w.last_close / nullif(w.first_close, 0) - 1, ${RATIO_SCALE}
                )::text,
                'return_with_payouts_ratio', round(
                  (w.last_close + (select per_share from window_payouts))
                    / nullif(w.first_close, 0) - 1,
                  ${RATIO_SCALE}
                )::text,
                'adjusted', exists (
                  select 1 from events e, range r
                   where e.record_date <= r.to_date
                     and (r.from_date is null or e.record_date >= r.from_date)
                )
              )
              from window_prices w
            ),
            'marks', coalesce((
              select json_agg(m order by m.trade_date)
                from (
                  select l.trade_date,
                         l.kind::text as side,
                         sum(l.quantity)::text as quantity,
                         round(
                           sum(l.quantity * l.unit_price) / nullif(sum(l.quantity), 0),
                           ${PRICE_SCALE}
                         )::text as unit_price
                    from ledger l
                   cross join range r
                   where l.kind in ('buy', 'sell')
                     and l.quantity > 0
                     and (r.from_date is null or l.trade_date >= r.from_date)
                     and l.trade_date <= r.to_date
                   group by l.trade_date, l.kind
                ) m
            ), '[]'::json),
            'payout_months', coalesce((
              select json_agg(
                       json_build_object(
                         'month', a.month,
                         'dividend', coalesce(p.dividend, 0)::text,
                         'jcp', coalesce(p.jcp, 0)::text,
                         'income', coalesce(p.income, 0)::text,
                         'interest', coalesce(p.interest, 0)::text,
                         'amortization', coalesce(p.amortization, 0)::text,
                         'total', coalesce(p.total, 0)::text
                       )
                       order by a.month
                     )
                from month_axis a
                left join payouts_by_month p on p.month = a.month
            ), '[]'::json),
            'payouts_total_12m', (select received from payouts_12m)::text,
            'upcoming_payouts', coalesce((
              select json_agg(
                       json_build_object(
                         'transaction_id', l.id,
                         'settlement_date', l.settlement_date,
                         'payout_kind', l.payout_kind,
                         'net_amount', l.net_amount::text
                       )
                       order by l.settlement_date
                     )
                from ledger l
               where l.kind = 'payout' and l.confirmed_at is null
            ), '[]'::json),
            'transactions', coalesce((
              select json_agg(t order by t.trade_date desc, t.created_at desc)
                from (
                  select l.id,
                         l.kind,
                         l.payout_kind,
                         l.trade_date,
                         l.settlement_date,
                         l.quantity::text as quantity,
                         l.unit_price::text as unit_price,
                         l.net_amount::text as net_amount,
                         l.confirmed_at,
                         l.portfolio_id,
                         l.portfolio_name,
                         i.name as institution_name,
                         l.created_at
                    from ledger l
                    left join institution i on i.id = l.institution_id
                   where (${filter.kind}::text is null
                          or l.kind::text = ${filter.kind}::text)
                   order by l.trade_date desc, l.created_at desc
                   limit ${ASSET_PAGE_TRANSACTION_LIMIT}
                ) t
            ), '[]'::json),
            'transactions_total', (
              select count(*)::int from ledger l
               where (${filter.kind}::text is null
                      or l.kind::text = ${filter.kind}::text)
            ),
            -- As contagens são de antes do filtro de tipo: é o que faz a opção
            -- "Compra 12" continuar dizendo 12 depois de ser escolhida.
            'transaction_facets', coalesce((
              select json_agg(
                       json_build_object('kind', f.kind, 'count', f.count)
                       order by f.count desc, f.kind
                     )
                from (
                  select l.kind, count(*)::int as count from ledger l group by l.kind
                ) f
            ), '[]'::json),
            'corporate_events', coalesce((
              select json_agg(
                       json_build_object(
                         'id', ce.id,
                         'kind', ce.kind,
                         'record_date', ce.record_date,
                         'ratio_from', ce.ratio_from::text,
                         'ratio_to', ce.ratio_to::text,
                         'confirmed_at', ce.confirmed_at
                       )
                       order by ce.record_date desc
                     )
                from corporate_event ce
               where ce.asset_id = (select asset_id from target)
            ), '[]'::json),
            'portfolios', coalesce((
              select json_agg(
                       json_build_object(
                         'portfolio_id', h.portfolio_id,
                         'portfolio_name', h.portfolio_name,
                         'quantity', case
                                       when (select unit from asset_row) = 'quantity'
                                       then h.quantity::text
                                     end,
                         'value', h.market_value::text
                       )
                       order by h.market_value desc
                     )
                from holdings h
            ), '[]'::json),
            'custodians', coalesce((
              select json_agg(
                       json_build_object(
                         'institution_id', c.institution_id,
                         'institution_name', c.institution_name
                       )
                       order by c.institution_name
                     )
                from (
                  select distinct l.institution_id, i.name as institution_name
                    from ledger l
                    join institution i on i.id = l.institution_id
                ) c
            ), '[]'::json)
          ) as page
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
