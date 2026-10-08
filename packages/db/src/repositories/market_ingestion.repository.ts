import type {
  AnnouncedPayoutWrite,
  AssetPriceWrite,
  IndexQuoteWrite,
  MarketIngestionRepository,
  SourceStatus,
} from '@patrimonio/application';
import {
  isMarketRunKind,
  parseMarketSourceRunFromDB,
  parsePriceableAssetFromDB,
} from '@patrimonio/domain';
import type { DateOnly, MarketRunKind, Row } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { v7 as uuidv7 } from 'uuid';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';
import { ARRAY_OID } from '../support/array_oid.js';

/**
 * A escrita das tabelas que o mundo externo alimenta. Três regras valem para
 * todas as consultas deste arquivo:
 *
 * 1. **Escrita em lote, por `unnest`.** Trezentos preços são uma consulta, não
 *    trezentas idas ao banco — o banco está em outra rede, e laço de `await` com
 *    uma escrita por iteração é o que transforma uma carga de dez anos em algo
 *    que não termina.
 * 2. **`UPSERT` sempre.** Recoletar o mesmo dia é normal: o job reexecuta, a
 *    fonte corrige um preço, e reimportar o mesmo ano do COTAHIST não pode
 *    duplicar nada.
 * 3. **O OID do array vai explícito.** Sem ele o driver adivinha o tipo pelo
 *    primeiro elemento e manda o escalar, e o Postgres recusa com "cannot cast
 *    type X to X[]".
 */
/**
 * A última linha de cada chave vence. O `ON CONFLICT DO UPDATE` do Postgres
 * recusa um lote que traz a mesma chave duas vezes — "cannot affect row a second
 * time" —, e um lote de cem mil preços do COTAHIST não pode ser perdido inteiro
 * porque um papel apareceu duas vezes no mesmo dia.
 */
const lastPerKey = <T>(rows: readonly T[], keyOf: (row: T) => string): readonly T[] => {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(keyOf(row), row);

  return [...byKey.values()];
};

export const createMarketIngestionRepository = (
  sql: Connection,
): MarketIngestionRepository => ({
  upsertPrices: async (incoming: readonly AssetPriceWrite[]) => {
    const rows = lastPerKey(incoming, (row) => `${row.asset_id}\u0000${row.price_date}`);

    if (rows.length === 0) return success(0);

    try {
      const written = await sql<{ asset_id: string }[]>`
        insert into asset_price (asset_id, price_date, close, source, source_kind, fetched_at)
        select * , now()
          from unnest(
            ${sql.array(
              rows.map((row) => row.asset_id),
              ARRAY_OID.uuid,
            )}::uuid[],
            ${sql.array(
              rows.map((row) => row.price_date),
              ARRAY_OID.date,
            )}::date[],
            ${sql.array(
              rows.map((row) => row.close),
              ARRAY_OID.numeric,
            )}::numeric[],
            ${sql.array(
              rows.map((row) => row.source),
              ARRAY_OID.text,
            )}::text[],
            ${sql.array(
              rows.map((row) => row.source_kind),
              ARRAY_OID.text,
            )}::price_source_kind[]
          )
        on conflict (asset_id, price_date) do update set
          close       = excluded.close,
          source      = excluded.source,
          source_kind = excluded.source_kind,
          fetched_at  = excluded.fetched_at
        returning asset_id
      `;

      return success(written.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  upsertIndexQuotes: async (incoming: readonly IndexQuoteWrite[]) => {
    const rows = lastPerKey(
      incoming,
      (row) => `${row.index_code}\u0000${row.quote_date}`,
    );

    if (rows.length === 0) return success(0);

    try {
      const written = await sql<{ index_code: string }[]>`
        insert into index_quote (index_code, quote_date, daily_factor, raw_value, source, fetched_at)
        select *, now()
          from unnest(
            ${sql.array(
              rows.map((row) => row.index_code),
              ARRAY_OID.text,
            )}::text[],
            ${sql.array(
              rows.map((row) => row.quote_date),
              ARRAY_OID.date,
            )}::date[],
            ${sql.array(
              rows.map((row) => row.daily_factor),
              ARRAY_OID.numeric,
            )}::numeric[],
            ${sql.array(
              rows.map((row) => row.raw_value),
              ARRAY_OID.numeric,
            )}::numeric[],
            ${sql.array(
              rows.map((row) => row.source),
              ARRAY_OID.text,
            )}::text[]
          )
        on conflict (index_code, quote_date) do update set
          daily_factor = excluded.daily_factor,
          raw_value    = excluded.raw_value,
          source       = excluded.source,
          fetched_at   = excluded.fetched_at
        returning index_code
      `;

      return success(written.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * Os papéis que precisam de preço: quem aparece no livro com quantidade
   * diferente de zero e tem cotação automática. Sai do **livro**, e não de
   * `position_daily`, porque a projeção do dia pode ainda não existir — é
   * exatamente a coleta de hoje que a alimenta.
   *
   * Renda fixa de banco fica fora pelo `b3_type is not null`: ela é marcada na
   * curva e não tem preço de mercado para buscar.
   */
  priceableAssets: async (date: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        select asset.id        as asset_id,
               asset.ticker    as ticker,
               asset.b3_type   as b3_type,
               asset.indexer   as indexer,
               asset.maturity_date as maturity_date,
               min(transaction.trade_date) as first_trade_date
          from transaction
          join asset on asset.id = transaction.asset_id
         where transaction.trade_date <= ${date}
           and asset.price_source = 'auto'
           and asset.archived_at is null
           and asset.b3_type is not null
           and asset.b3_type <> 'cash'
         group by asset.id, asset.ticker, asset.b3_type, asset.indexer, asset.maturity_date
         order by asset.ticker
      `;

      return success(rows.map((row) => parsePriceableAssetFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  priceableAsset: async (assetId: string) => {
    try {
      const rows = await sql<Row[]>`
        select asset.id        as asset_id,
               asset.ticker    as ticker,
               asset.b3_type   as b3_type,
               asset.indexer   as indexer,
               asset.maturity_date as maturity_date,
               coalesce(min(transaction.trade_date), current_date) as first_trade_date
          from asset
          left join transaction on transaction.asset_id = asset.id
         where asset.id = ${assetId}
         group by asset.id, asset.ticker, asset.b3_type, asset.indexer, asset.maturity_date
      `;

      const row = rows[0];

      return success(row === undefined ? null : parsePriceableAssetFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  pricedDates: async (assetId: string, from: DateOnly, to: DateOnly) => {
    try {
      const rows = await sql<{ price_date: string }[]>`
        select price_date
          from asset_price
         where asset_id = ${assetId}
           and price_date between ${from} and ${to}
         order by price_date
      `;

      return success(rows.map((row) => row.price_date as DateOnly));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  recordRun: async (draft) => {
    try {
      const rows = await sql<Row[]>`
        insert into market_source_run (
          id, source, kind, reference_date, started_at, finished_at, ok,
          source_kind, requests, items, missing, error, detail
        )
        values (
          ${uuidv7()}, ${draft.source}, ${draft.kind}, ${draft.reference_date ?? null},
          ${draft.started_at}, ${draft.finished_at}, ${draft.ok},
          ${draft.source_kind ?? null}, ${draft.requests ?? 0}, ${draft.items ?? 0},
          ${draft.missing ?? 0}, ${draft.error ?? null},
          ${draft.detail === null || draft.detail === undefined ? null : JSON.stringify(draft.detail)}::jsonb
        )
        returning *
      `;

      const row = rows[0];
      if (row === undefined) {
        return failure(getRepositoryError(new Error('registro de coleta sem retorno')));
      }

      return success(parseMarketSourceRunFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * A situação de cada fonte: a última execução de cada par (fonte, tipo), mais
   * o consumo de requisições na janela do orçamento.
   *
   * `distinct on` em vez de uma subconsulta com `max`: o índice
   * `(source, finished_at desc)` serve os dois, e esta forma lê a linha inteira
   * sem um segundo acesso à tabela.
   */
  sourceStatuses: async (options) => {
    try {
      const rows = await sql<Row[]>`
        with ultimo as (
          select distinct on (source, kind) *
            from market_source_run
           order by source, kind, finished_at desc
        ),
        consumo as (
          select source, sum(requests)::integer as requests
            from market_source_run
           where started_at >= ${options.requests_since}
           group by source
        )
        select ultimo.*, coalesce(consumo.requests, 0) as requests_in_window
          from ultimo
          left join consumo on consumo.source = ultimo.source
         order by ultimo.source, ultimo.kind
      `;

      const statuses: SourceStatus[] = rows.map((row) => ({
        source: String(row['source']),
        kind: isMarketRunKind(row['kind']) ? row['kind'] : 'quotes',
        last_run: parseMarketSourceRunFromDB(row),
        requests_in_window: Number(row['requests_in_window'] ?? 0),
      }));

      return success(statuses);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  recentFailures: async (limit: number) => {
    try {
      const rows = await sql<Row[]>`
        select *
          from market_source_run
         where ok = false
         order by finished_at desc
         limit ${limit}
      `;

      return success(rows.map((row) => parseMarketSourceRunFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  lastRunOf: async (source: string, kind: MarketRunKind) => {
    try {
      const rows = await sql<Row[]>`
        select *
          from market_source_run
         where source = ${source} and kind = ${kind}
         order by finished_at desc
         limit 1
      `;

      const row = rows[0];

      return success(row === undefined ? null : parseMarketSourceRunFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * Reanunciar o mesmo provento não cria linha nova nem desfaz o lançamento já
   * materializado: o `UPSERT` atualiza valor e data de pagamento, e
   * `materialized_transaction_id` fica como está.
   */
  upsertAnnouncedPayouts: async (incoming: readonly AnnouncedPayoutWrite[]) => {
    const rows = lastPerKey(
      incoming,
      (row) => `${row.asset_id}\u0000${row.payout_kind}\u0000${row.record_date}`,
    );

    if (rows.length === 0) return success(0);

    try {
      const written = await sql<{ id: string }[]>`
        insert into announced_payout (
          id, asset_id, payout_kind, record_date, payment_date, amount_per_share, source
        )
        select *
          from unnest(
            ${sql.array(
              rows.map(() => uuidv7()),
              ARRAY_OID.uuid,
            )}::uuid[],
            ${sql.array(
              rows.map((row) => row.asset_id),
              ARRAY_OID.uuid,
            )}::uuid[],
            ${sql.array(
              rows.map((row) => row.payout_kind),
              ARRAY_OID.text,
            )}::payout_kind[],
            ${sql.array(
              rows.map((row) => row.record_date),
              ARRAY_OID.date,
            )}::date[],
            ${sql.array(
              rows.map((row) => row.payment_date),
              ARRAY_OID.date,
            )}::date[],
            ${sql.array(
              rows.map((row) => row.amount_per_share),
              ARRAY_OID.numeric,
            )}::numeric[],
            ${sql.array(
              rows.map((row) => row.source),
              ARRAY_OID.text,
            )}::text[]
          )
        on conflict (asset_id, payout_kind, record_date) do update set
          payment_date     = excluded.payment_date,
          amount_per_share = excluded.amount_per_share,
          source           = excluded.source
        returning id
      `;

      return success(written.length);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  pendingAnnouncedPayouts: async () => {
    try {
      const rows = await sql<Row[]>`
        select id, asset_id, payout_kind, record_date, payment_date, amount_per_share
          from announced_payout
         where materialized_transaction_id is null
         order by record_date
      `;

      return success(
        rows.map((row) => ({
          id: String(row['id']),
          asset_id: String(row['asset_id']),
          payout_kind: row['payout_kind'] as 'dividend',
          record_date: row['record_date'] as DateOnly,
          payment_date: (row['payment_date'] ?? null) as DateOnly | null,
          amount_per_share: String(row['amount_per_share']),
        })),
      );
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  markPayoutMaterialized: async (announcedId: string, transactionId: string) => {
    try {
      const rows = await sql<{ id: string }[]>`
        update announced_payout
           set materialized_transaction_id = ${transactionId}
         where id = ${announcedId}
           and materialized_transaction_id is null
        returning id
      `;

      return success(rows.length > 0);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
