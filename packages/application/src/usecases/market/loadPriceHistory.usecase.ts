import type { Asset, DateOnly, MarketSourceRunDraft } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError, isFormatChangedError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { PriceHistorySource } from '../../interfaces/market_data.js';
import type { AssetPriceWrite } from '../../interfaces/market_ingestion.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { recalcEventsFor } from './collectMarketData.usecase.js';

/**
 * A carga do histórico de fechamentos pelo COTAHIST: dez anos de preço sem gastar
 * cota de API.
 *
 * Sem papéis informados, a carga vale para os ativos de mercado já cadastrados
 * que têm cotação em bolsa. Papel informado que não é ativo não tem onde gravar
 * o preço e volta como ausente — o preço pertence a um ativo, e o catálogo de
 * instrumentos não é cadastro.
 *
 * Recarregar o mesmo ano não duplica linha: a chave é (ativo, data), e o preço é
 * o negociado na data, sem ajuste por evento. Ao terminar, pede o recálculo das
 * carteiras que têm o ativo a partir do preço mais antigo gravado, porque a
 * série nova muda o patrimônio daquele período.
 */
export const COTAHIST_LOAD_SOURCE = 'cotahist';

export type LoadPriceHistoryInput = {
  readonly from_year: number;
  readonly to_year: number;
  /** Vazio carrega os ativos de mercado cadastrados. */
  readonly tickers?: readonly string[] | undefined;
};

export type LoadPriceHistoryResult = {
  readonly assets: number;
  readonly lines_read: number;
  readonly records_kept: number;
  readonly prices_written: number;
  readonly missing: readonly string[];
  readonly unavailable_years: readonly number[];
  readonly recalculated: readonly string[];
};

export type LoadPriceHistoryDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly history: PriceHistorySource;
};

const BATCH = 5000;

const listable = (asset: Asset): boolean =>
  asset.origin === 'market' &&
  asset.archived_at === null &&
  asset.b3_type !== null &&
  asset.b3_type !== 'treasury';

export const loadPriceHistory = (deps: LoadPriceHistoryDeps) =>
  either(async function* (input: LoadPriceHistoryInput) {
    if (input.from_year > input.to_year) {
      return yield* failure(
        new BadRequestError('O ano inicial não pode ser posterior ao final'),
      );
    }

    const startedAt = deps.clock.now().toISOString();
    const today = deps.clock.today();

    const assets = yield* await deps.unitOfWork.run(async (repositories) => {
      const listed = await repositories.assets.list({});
      if (listed.isFailure()) return listed;

      return success(listed.value.filter(listable));
    });

    const requested = (input.tickers ?? []).map((ticker) => ticker.toUpperCase());
    const byTicker = new Map(assets.map((asset) => [asset.ticker.toUpperCase(), asset]));

    const targets =
      requested.length === 0
        ? assets
        : requested.flatMap((ticker) => {
            const asset = byTicker.get(ticker);
            return asset === undefined ? [] : [asset];
          });
    const unregistered = requested.filter((ticker) => !byTicker.has(ticker));

    const from = `${input.from_year}-01-01` as DateOnly;
    const lastDay = `${input.to_year}-12-31` as DateOnly;
    const to = lastDay > today ? today : lastDay;

    if (targets.length === 0) {
      return {
        assets: 0,
        lines_read: 0,
        records_kept: 0,
        prices_written: 0,
        missing: unregistered,
        unavailable_years: [],
        recalculated: [],
      } satisfies LoadPriceHistoryResult;
    }

    const read = await deps.history.fetchRange(
      targets.map((asset) => asset.ticker),
      from,
      to,
    );

    if (read.isFailure()) {
      yield* await deps.unitOfWork.run(async (repositories) =>
        repositories.market.recordRun({
          source: COTAHIST_LOAD_SOURCE,
          kind: 'cotahist',
          reference_date: today,
          started_at: startedAt,
          finished_at: deps.clock.now().toISOString(),
          ok: false,
          source_kind: null,
          requests: 0,
          items: 0,
          missing: 0,
          error: read.value.message,
          detail: isFormatChangedError(read.value)
            ? { field: read.value.field, received: read.value.received }
            : null,
        } satisfies MarketSourceRunDraft),
      );

      return yield* read;
    }

    const report = read.value;
    const idOf = new Map(targets.map((asset) => [asset.ticker.toUpperCase(), asset.id]));

    const rows: AssetPriceWrite[] = report.quotes.flatMap((quote) => {
      const id = idOf.get(quote.ticker.toUpperCase());
      return id === undefined
        ? []
        : [
            {
              asset_id: id,
              price_date: quote.price_date,
              close: quote.close,
              source: COTAHIST_LOAD_SOURCE,
              source_kind: 'primary' as const,
            },
          ];
    });

    const earliestOf = new Map<string, DateOnly>();
    for (const row of rows) {
      const current = earliestOf.get(row.asset_id);
      if (current === undefined || row.price_date < current) {
        earliestOf.set(row.asset_id, row.price_date);
      }
    }

    const missing = [...unregistered, ...report.missing];

    return yield* await deps.unitOfWork.run<AppError, LoadPriceHistoryResult>(
      async (repositories) => {
        let written = 0;

        for (let start = 0; start < rows.length; start += BATCH) {
          const batch = await repositories.market.upsertPrices(
            rows.slice(start, start + BATCH),
          );
          if (batch.isFailure()) return batch;

          written += batch.value;
        }

        const recalculated = new Set<string>();

        for (const [assetId, earliest] of earliestOf) {
          const holdings = await repositories.ledger.portfoliosHoldingAsset(assetId);
          if (holdings.isFailure()) return holdings;

          const events = recalcEventsFor(holdings.value, earliest);
          const enqueued = await repositories.outbox.enqueue(events);
          if (enqueued.isFailure()) return enqueued;

          for (const holding of holdings.value) recalculated.add(holding.portfolio_id);
        }

        const recorded = await repositories.market.recordRun({
          source: COTAHIST_LOAD_SOURCE,
          kind: 'cotahist',
          reference_date: today,
          started_at: startedAt,
          finished_at: deps.clock.now().toISOString(),
          ok: true,
          source_kind: 'primary',
          requests: 0,
          items: written,
          missing: missing.length,
          error: null,
          detail: {
            from_year: input.from_year,
            to_year: input.to_year,
            assets: targets.length,
            lines_read: report.lines_read,
            records_kept: report.records_kept,
            missing,
            unavailable_years: [...report.unavailable_years],
          },
        } satisfies MarketSourceRunDraft);
        if (recorded.isFailure()) return recorded;

        return success({
          assets: targets.length,
          lines_read: report.lines_read,
          records_kept: report.records_kept,
          prices_written: written,
          missing,
          unavailable_years: report.unavailable_years,
          recalculated: [...recalculated],
        });
      },
    );
  });
