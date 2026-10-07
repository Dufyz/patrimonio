import type { DateOnly, PriceSourceKind } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { QuoteSource } from '../../interfaces/market_data.js';
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

    const history = await deps.quotes.fetchHistory(
      context.asset.ticker,
      window.from,
      window.to,
    );

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

    const closing = history.value;

    const rows: AssetPriceWrite[] = closing.quotes
      .filter((quote) => quote.price_date >= window.from && quote.price_date <= window.to)
      .map((quote) => ({
        asset_id: input.asset_id,
        price_date: quote.price_date,
        close: quote.close,
        source: closing.source,
        source_kind: closing.source_kind === 'none' ? 'primary' : closing.source_kind,
      }));

    const earliest = rows.reduce<DateOnly | null>(
      (oldest, row) => (oldest === null || row.price_date < oldest ? row.price_date : oldest),
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

        // O recálculo pedido agora é o que roda **depois** do backfill, e é ele
        // que põe a série na tela. A chave de coalescência não carrega data, e um
        // pedido mais antigo recua o `from_date` do que já estava pendente.
        const events =
          earliest === null
            ? []
            : recalcEventsFor(
                context.holdings,
                earliest,
                input.origin_request_id,
              );

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
