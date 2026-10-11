import type { DateOnly, PriceSourceKind, PriceableAsset } from '@patrimonio/domain';
import { addDays, parseTreasuryTicker } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { NotFoundError, isFormatChangedError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type {
  HistoricalPrices,
  PriceHistorySource,
  QuoteSource,
  SourcedClosing,
  TreasurySource,
} from '../../interfaces/market_data.js';
import type { AssetPriceWrite } from '../../interfaces/market_ingestion.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { applyPlan } from '../../plans/apply.js';
import { planBackfillWindow } from '../../plans/market.plan.js';
import { recalcEventsFor, runOf } from './collectMarketData.usecase.js';

/**
 * O backfill de um papel: preencher o preço desde a data da primeira compra.
 *
 * Lançar hoje uma compra de 2015 é caso normal, e é o caso que define o
 * desenho. A posição de hoje já está certa no instante em que o lançamento é
 * gravado — ela sai do livro. O que falta é a **série**: sem preço de 2015 a
 * 2026, a tela de desempenho não tem curva e o patrimônio daquele período nasce
 * errado.
 *
 * ## A ordem, e por que ela é assim
 *
 * O plano do lançamento emite `recalc` e `backfill` na mesma transação. Os dois
 * são despachados juntos, e o recálculo pode começar antes do preço existir —
 * ele não erra por isso: reconstrói com o que há, marcando as linhas como
 * `missing`, e a posição entra pelo custo em vez de zero.
 *
 * O que fecha a conta é este estágio pedir o recálculo **de novo** ao terminar,
 * a partir da data afetada. O resultado é que o último recálculo é sempre o que
 * roda depois do backfill, que é o que o critério pede — sem precisar de
 * ordenação entre filas, que é o tipo de acoplamento que trava o pipeline
 * inteiro quando uma fonte fica fora do ar.
 *
 * ## Quem não tem backfill
 *
 * Renda fixa de banco é marcada na curva pela taxa cadastrada: nenhuma fonte tem
 * preço dela. Disparar busca gastaria requisição para receber "não conheço esse
 * papel", e por isso a janela é calculada e volta `needed: false` antes de
 * qualquer chamada.
 */
export type BackfillAssetInput = {
  readonly asset_id: string;
  readonly reference_date?: DateOnly | undefined;
  readonly origin_request_id?: string | undefined;
};

export type BackfillAssetResult = {
  readonly asset_id: string;
  readonly ticker: string;
  readonly skipped: boolean;
  readonly from: DateOnly | null;
  readonly to: DateOnly | null;
  readonly prices_written: number;
  readonly source: string;
  readonly source_kind: PriceSourceKind | 'none';
  /** As carteiras cujo recálculo foi pedido ao terminar. */
  readonly recalculated: readonly string[];
};

export type BackfillAssetDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly quotes: QuoteSource;
  /**
   * O preço do título público vem da tabela do Tesouro, e não de uma fonte de
   * cotação de bolsa. Sem ela o backfill do Tesouro fica sem fonte.
   */
  readonly treasury?: TreasurySource | undefined;
  /** O arquivo anual da B3, consultado antes da brapi. */
  readonly history?: PriceHistorySource | undefined;
};

/** O histórico do título, no formato que o resto do backfill já consome. */
const treasuryHistory = async (
  source: TreasurySource,
  asset: PriceableAsset,
  window: { readonly from: DateOnly; readonly to: DateOnly },
): Promise<Either<AppError, SourcedClosing>> => {
  const identity =
    parseTreasuryTicker(asset.ticker) ??
    (asset.indexer === 'ipca_plus' ||
    asset.indexer === 'prefixed' ||
    asset.indexer === 'selic_plus'
      ? asset.maturity_date === null
        ? null
        : { kind: asset.indexer, coupon: false, maturity_date: asset.maturity_date }
      : null);

  if (identity === null) {
    return success<SourcedClosing>({
      quotes: [],
      missing: [asset.ticker],
      source: 'none',
      source_kind: 'none',
      requests: 0,
    });
  }

  const history = await source.fetchHistory(identity, window.from, window.to);
  if (history.isFailure()) return history;

  return success({
    quotes: history.value.quotes.map((quote) => ({
      ticker: asset.ticker,
      price_date: quote.quote_date,
      close: quote.sell_price,
    })),
    missing: [],
    source: history.value.source,
    source_kind: history.value.source_kind,
    requests: history.value.source === 'none' ? 0 : 1,
  });
};

export const backfillAsset = (deps: BackfillAssetDeps) =>
  either(async function* (input: BackfillAssetInput) {
    const date = input.reference_date ?? deps.clock.today();

    const context = yield* await deps.unitOfWork.run(async (repositories) => {
      const asset = await repositories.market.priceableAsset(input.asset_id);
      if (asset.isFailure()) return asset;

      if (asset.value === null) {
        return failure(new NotFoundError(`Ativo ${input.asset_id} não encontrado`));
      }

      const calendar = await repositories.businessDays.listBetween(
        asset.value.first_trade_date,
        date,
      );
      if (calendar.isFailure()) return calendar;

      const priced = await repositories.market.pricedDates(
        input.asset_id,
        asset.value.first_trade_date,
        date,
      );
      if (priced.isFailure()) return priced;

      const holdings = await repositories.ledger.portfoliosHoldingAsset(input.asset_id);
      if (holdings.isFailure()) return holdings;

      return success({
        asset: asset.value,
        businessDays: calendar.value
          .filter((day) => day.is_business_day)
          .map((day) => day.calendar_date),
        priced: priced.value,
        holdings: holdings.value,
      });
    });

    // Preço de mercado existe para papel listado e para Tesouro. Título bancário
    // e crédito privado são marcados na curva, e não têm o que buscar.
    const hasMarketPrice =
      context.asset.b3_type !== null && context.asset.b3_type !== 'cash';

    const window = planBackfillWindow({
      first_trade_date: context.asset.first_trade_date,
      reference_date: date,
      business_days: context.businessDays,
      already_priced: context.priced,
      has_market_price: hasMarketPrice,
    });

    if (!window.needed) {
      const nothing: BackfillAssetResult = {
        asset_id: input.asset_id,
        ticker: context.asset.ticker,
        skipped: true,
        from: null,
        to: null,
        prices_written: 0,
        source: 'none',
        source_kind: 'none',
        recalculated: [],
      };

      return nothing;
    }

    const startedAt = deps.clock.now().toISOString();

    const viaTreasury =
      context.asset.b3_type === 'treasury' && deps.treasury !== undefined;

    // O arquivo anual da B3 vem antes: não gasta cota, e a brapi só cobre o que
    // ele ainda não tem. Formato mudado nele para tudo, como em qualquer fonte;
    // arquivo fora do ar deixa a brapi cobrir a janela inteira.
    let archive: HistoricalPrices | null = null;

    if (!viaTreasury && deps.history !== undefined) {
      const read = await deps.history.fetchRange(
        [context.asset.ticker],
        window.from,
        window.to,
      );

      if (read.isSuccess()) {
        archive = read.value;
      } else if (isFormatChangedError(read.value)) {
        yield* await deps.unitOfWork.run(async (repositories) =>
          repositories.market.recordRun(
            runOf({
              source: 'cotahist',
              kind: 'cotahist',
              date,
              startedAt,
              finishedAt: deps.clock.now().toISOString(),
              ok: false,
              error: read.value,
            }),
          ),
        );

        return yield* read;
      }
    }

    const archived = (archive?.quotes ?? []).filter(
      (quote) => quote.price_date >= window.from && quote.price_date <= window.to,
    );
    const covered = archived.reduce<DateOnly | null>(
      (latest, quote) =>
        latest === null || quote.price_date > latest ? quote.price_date : latest,
      null,
    );
    const gapFrom = covered === null ? window.from : addDays(covered, 1);

    // O dia de hoje fica para a coleta diária: pedir só ele à brapi gastaria uma
    // requisição para um preço que o fechamento já traz.
    const needsLive =
      viaTreasury ||
      covered === null ||
      context.businessDays.some(
        (day) => day >= gapFrom && day <= window.to && day < date,
      );

    let live: SourcedClosing | null = null;

    if (needsLive) {
      const history = viaTreasury
        ? await treasuryHistory(deps.treasury as TreasurySource, context.asset, {
            from: gapFrom,
            to: window.to,
          })
        : await deps.quotes.fetchHistory(context.asset.ticker, gapFrom, window.to);

      if (history.isFailure()) {
        yield* await deps.unitOfWork.run(async (repositories) =>
          repositories.market.recordRun(
            runOf({
              source: 'history',
              kind: 'backfill',
              date,
              startedAt,
              finishedAt: deps.clock.now().toISOString(),
              ok: false,
              error: history.value,
            }),
          ),
        );

        // Formato mudado é definitivo; fonte fora do ar é transitória e o job
        // reexecuta. Os dois sobem, e o `defineStage` decide qual é qual.
        return yield* history;
      }

      live = history.value;
    }

    const closing: SourcedClosing = live ?? {
      quotes: [],
      missing: [],
      source: 'cotahist',
      source_kind: 'primary',
      requests: 0,
    };

    const rows: AssetPriceWrite[] = [
      ...archived.map((quote): AssetPriceWrite => ({
        asset_id: input.asset_id,
        price_date: quote.price_date,
        close: quote.close,
        source: 'cotahist',
        source_kind: 'primary',
      })),
      ...closing.quotes
        .filter(
          (quote) => quote.price_date >= window.from && quote.price_date <= window.to,
        )
        .map((quote): AssetPriceWrite => ({
          asset_id: input.asset_id,
          price_date: quote.price_date,
          close: quote.close,
          source: closing.source,
          source_kind: closing.source_kind === 'none' ? 'primary' : closing.source_kind,
        })),
    ];

    const earliest = rows.reduce<DateOnly | null>(
      (oldest, row) =>
        oldest === null || row.price_date < oldest ? row.price_date : oldest,
      null,
    );

    const finishedAt = deps.clock.now().toISOString();

    return yield* await deps.unitOfWork.run<AppError, BackfillAssetResult>(
      async (repositories) => {
        const written = await repositories.market.upsertPrices(rows);
        if (written.isFailure()) return written;

        const recorded = await repositories.market.recordRun(
          runOf({
            source: closing.source,
            kind: 'backfill',
            date,
            startedAt,
            finishedAt,
            ok: true,
            sourceKind: closing.source_kind === 'none' ? null : closing.source_kind,
            requests: closing.requests,
            items: written.value,
            missing: closing.missing.length,
          }),
        );
        if (recorded.isFailure()) return recorded;

        if (archived.length > 0) {
          const archiveRun = await repositories.market.recordRun(
            runOf({
              source: 'cotahist',
              kind: 'cotahist',
              date,
              startedAt,
              finishedAt,
              ok: true,
              sourceKind: 'primary',
              items: archived.length,
              missing: archive?.missing.length ?? 0,
            }),
          );
          if (archiveRun.isFailure()) return archiveRun;
        }

        // O recálculo pedido agora é o que roda **depois** do backfill, e é ele
        // que põe a série na tela. A chave de coalescência não carrega data, e um
        // pedido mais antigo recua o `from_date` do que já estava pendente.
        const events =
          earliest === null
            ? []
            : recalcEventsFor(context.holdings, earliest, input.origin_request_id);

        const applied = await applyPlan(repositories, {
          stage: 'market',
          outcome: 'succeeded',
          portfolio_id: null,
          reference_date: date,
          events,
          ...(input.origin_request_id === undefined
            ? {}
            : { origin_request_id: input.origin_request_id }),
        });
        if (applied.isFailure()) return applied;

        return success({
          asset_id: input.asset_id,
          ticker: context.asset.ticker,
          skipped: false,
          from: window.from,
          to: window.to,
          prices_written: written.value,
          source: closing.source,
          source_kind: closing.source_kind,
          recalculated: context.holdings.map((holding) => holding.portfolio_id),
        });
      },
    );
  });
