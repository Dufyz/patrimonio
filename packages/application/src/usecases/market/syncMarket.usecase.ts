import { addDays } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { MarketDataUnavailableError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import type { CollectMarketDataResult } from './collectMarketData.usecase.js';
import { lastBusinessDay } from './lastBusinessDay.js';

/**
 * A sincronização até o D-1, a única operação que mantém os dados de mercado em
 * dia. Tem dois modos:
 *
 * - **`incremental`** (agendamento das 09:00 e retomada na inicialização): olha o
 *   último preço gravado e preenche os dias úteis que faltam até o D-1. Com tudo
 *   em dia, refaz só o D-1, o que também corrige um índice ou o Tesouro que
 *   tenham falhado na rodada anterior.
 * - **`reset`** (o botão "Atualizar agora"): refaz tudo, sem olhar o que já está
 *   carregado — preços desde a primeira compra, índices, Tesouro, catálogos,
 *   instituições — e pede o recálculo e o fechamento.
 *
 * Cada passo falha sozinho e os demais seguem; a sincronização só falha quando
 * nenhum passo funcionou. Um dia sem cotação (arquivo ainda não publicado) fica
 * pendente: o último preço gravado não avança, e a próxima execução o retoma.
 */
export type SyncMode = 'incremental' | 'reset';

export type SyncMarketInput = {
  readonly mode: SyncMode;
  readonly origin_request_id?: string | undefined;
};

export type SyncStep = { readonly ok: boolean; readonly detail: string };

export type SyncMarketResult = {
  readonly mode: SyncMode;
  readonly target_date: DateOnly;
  /** Os dias coletados nesta execução, com cotação. */
  readonly collected: readonly DateOnly[];
  /** O primeiro dia cuja cotação não veio, quando houve. */
  readonly pending_from: DateOnly | null;
  readonly steps: Readonly<Record<string, SyncStep>>;
};

type Run<I> = (input: I) => Promise<Either<AppError, unknown>>;

export type SyncMarketDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly collectDay: (input: {
    readonly reference_date: DateOnly;
    readonly origin_request_id?: string | undefined;
  }) => Promise<Either<AppError, CollectMarketDataResult>>;
  readonly loadPriceHistory: Run<{
    readonly from_year: number;
    readonly to_year: number;
  }>;
  readonly loadIndexHistory: Run<Record<string, never>>;
  readonly syncPriceHistory: Run<Record<string, never>>;
  readonly backfillAsset: Run<{ readonly asset_id: string }>;
  readonly refreshInstrumentCatalog: Run<{ readonly force: boolean }>;
  /** Recarrega as instituições; sem `force`, só quando a última carga venceu. */
  readonly refreshInstitutions?: Run<{ readonly force: boolean }>;
};

/** Acima disto o preenchimento usa o arquivo anual, e não um arquivo por dia. */
export const MAX_DAILY_FILES = 20;

type Plan = {
  readonly target: DateOnly;
  readonly days: readonly DateOnly[];
  readonly last_price: DateOnly | null;
  readonly first_trade: DateOnly | null;
  readonly treasury_assets: readonly string[];
};

const yearOf = (date: DateOnly): number => Number(date.slice(0, 4));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const syncMarket = (deps: SyncMarketDeps) =>
  either(async function* (input: SyncMarketInput) {
    const plan = yield* await deps.unitOfWork.run<AppError, Plan>(
      async (repositories) => {
        const target = await lastBusinessDay(repositories, deps.clock.today());
        if (target.isFailure()) return target;

        const lastPrice = await repositories.market.lastPriceDate();
        if (lastPrice.isFailure()) return lastPrice;

        const firstTrade = await repositories.market.firstTradeDate();
        if (firstTrade.isFailure()) return firstTrade;

        let days: DateOnly[] = [target.value];

        if (lastPrice.value !== null && lastPrice.value < target.value) {
          const calendar = await repositories.businessDays.listBetween(
            addDays(lastPrice.value, 1),
            target.value,
          );
          if (calendar.isFailure()) return calendar;

          const missing = calendar.value
            .filter((day) => day.is_business_day)
            .map((day) => day.calendar_date)
            .sort();

          days = missing.length === 0 ? [target.value] : missing;
        }

        const assets = await repositories.market.priceableAssets(target.value);
        if (assets.isFailure()) return assets;

        return success({
          target: target.value,
          days,
          last_price: lastPrice.value,
          first_trade: firstTrade.value,
          treasury_assets: assets.value
            .filter((asset) => asset.b3_type === 'treasury')
            .map((asset) => asset.asset_id),
        });
      },
    );

    const steps: Record<string, SyncStep> = {};
    const collected: DateOnly[] = [];
    let pendingFrom: DateOnly | null = null;

    const step = async (
      key: string,
      work: () => Promise<Either<AppError, unknown> | string>,
    ): Promise<void> => {
      try {
        const done = await work();

        if (typeof done === 'string') {
          steps[key] = { ok: true, detail: done };
        } else if (done.isFailure()) {
          steps[key] = { ok: false, detail: done.value.message };
        } else {
          steps[key] = { ok: true, detail: 'ok' };
        }
      } catch (error) {
        steps[key] = { ok: false, detail: messageOf(error) };
      }
    };

    /**
     * Coleta cada dia em ordem. Para no primeiro dia sem cotação: coletar o
     * seguinte avançaria o último preço gravado e deixaria o buraco para sempre.
     */
    const collect = async (
      days: readonly DateOnly[],
    ): Promise<Either<AppError, string>> => {
      for (const day of days) {
        const done = await deps.collectDay({
          reference_date: day,
          ...(input.origin_request_id === undefined
            ? {}
            : { origin_request_id: input.origin_request_id }),
        });
        if (done.isFailure()) return done;

        if (!done.value.quotes_ok) {
          pendingFrom = pendingFrom ?? day;
          return success(
            `cotações de ${day} ainda não disponíveis; a próxima sincronização retoma`,
          );
        }

        if (!done.value.skipped) collected.push(day);
      }

      return success(`${collected.length} dia(s) coletado(s)`);
    };

    if (input.mode === 'reset') {
      // Preços de bolsa, da primeira compra até hoje, pelos arquivos anuais.
      if (plan.first_trade !== null) {
        const firstTrade = plan.first_trade;
        await step('history', () =>
          deps.loadPriceHistory({
            from_year: yearOf(firstTrade),
            to_year: yearOf(plan.target),
          }),
        );
      }

      await step('indices_history', () => deps.loadIndexHistory({}));

      // Títulos do Tesouro: o histórico de cada um, preenchendo o que falta.
      await step('treasury_history', async () => {
        for (const assetId of plan.treasury_assets) {
          const done = await deps.backfillAsset({ asset_id: assetId });
          if (done.isFailure()) return done;
        }

        return `${plan.treasury_assets.length} título(s)`;
      });

      await step('collect', () => collect([plan.target]));
    } else if (plan.days.length > MAX_DAILY_FILES && plan.last_price !== null) {
      // Janela longa: um arquivo anual é mais barato que dezenas de arquivos
      // diários.
      const lastPrice = plan.last_price;
      await step('history', () =>
        deps.loadPriceHistory({
          from_year: yearOf(lastPrice),
          to_year: yearOf(plan.target),
        }),
      );
      await step('collect', () => collect([plan.target]));
    } else {
      await step('collect', () => collect(plan.days));
    }

    await step('new_assets', () => deps.syncPriceHistory({}));

    const force = input.mode === 'reset';
    await step('instruments', () => deps.refreshInstrumentCatalog({ force }));

    if (deps.refreshInstitutions !== undefined) {
      const refresh = deps.refreshInstitutions;
      await step('institutions', () => refresh({ force }));
    }

    if (Object.values(steps).every((result) => !result.ok)) {
      return yield* failure(
        new MarketDataUnavailableError(
          `Nenhum passo da sincronização funcionou: ${Object.entries(steps)
            .map(([key, result]) => `${key}: ${result.detail}`)
            .join(' · ')}`,
        ),
      );
    }

    return {
      mode: input.mode,
      target_date: plan.target,
      collected,
      pending_from: pendingFrom,
      steps,
    } satisfies SyncMarketResult;
  });
