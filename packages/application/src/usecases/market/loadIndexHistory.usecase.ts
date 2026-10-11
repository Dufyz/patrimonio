import { dailyFactorsFrom } from '@patrimonio/calc';
import type { IndexObservation } from '@patrimonio/calc';
import { addDays } from '@patrimonio/domain';
import type { DateOnly, IndexCode } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { IndexProvider } from '../../interfaces/market_data.js';
import type { IndexQuoteWrite } from '../../interfaces/market_ingestion.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { recalcEventsFor, runOf } from './collectMarketData.usecase.js';

/**
 * A carga do histórico dos índices — CDI, Selic, IPCA, IBOV e IFIX — desde a
 * data do primeiro lançamento da instalação, pelas mesmas fontes da coleta do
 * dia. A coleta diária pede só o mês corrente; esta é a que preenche o resto.
 *
 * Os pedidos saem em janelas de um ano: a API do Banco Central limita o período
 * de séries diárias, e uma janela por vez deixa a falha de uma fonte custar um
 * ano, e não a carga inteira. Cada janela começa no primeiro dia do mês, porque
 * o IPCA é uma observação por mês e partir uma observação no meio a perderia.
 *
 * Recarregar não duplica nem apaga: a chave é (índice, data). Ao terminar, pede o
 * recálculo das carteiras desde a data inicial, porque a marcação da renda fixa
 * lê estes fatores.
 */
export const INDEX_HISTORY_CODES: readonly IndexCode[] = [
  'CDI',
  'SELIC',
  'IPCA',
  'IBOV',
  'IFIX',
];

export type LoadIndexHistoryInput = {
  /** Sem data, parte do primeiro lançamento da instalação. */
  readonly from?: DateOnly | undefined;
  readonly codes?: readonly IndexCode[] | undefined;
};

export type LoadIndexHistoryResult = {
  readonly from: DateOnly;
  readonly to: DateOnly;
  readonly written: Readonly<Record<string, number>>;
  /** Códigos que nenhuma fonte devolveu, no período todo. */
  readonly empty: readonly IndexCode[];
  readonly recalculated: readonly string[];
};

export type LoadIndexHistoryDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly indices: IndexProvider;
};

const BATCH = 2000;

const monthStart = (date: DateOnly): DateOnly => `${date.slice(0, 7)}-01` as DateOnly;

/** As janelas de um ano, a primeira a partir do mês de `from`. */
export const yearlyWindows = (
  from: DateOnly,
  to: DateOnly,
): readonly { readonly from: DateOnly; readonly to: DateOnly }[] => {
  const windows: { from: DateOnly; to: DateOnly }[] = [];
  let start = monthStart(from);

  while (start <= to) {
    const next = `${Number(start.slice(0, 4)) + 1}-${start.slice(5, 7)}-01` as DateOnly;
    const end = addDays(next, -1);

    windows.push({ from: start, to: end > to ? to : end });
    start = next;
  }

  return windows;
};

export const loadIndexHistory = (deps: LoadIndexHistoryDeps) =>
  either(async function* (input: LoadIndexHistoryInput = {}) {
    const today = deps.clock.today();
    const startedAt = deps.clock.now().toISOString();

    const from = yield* await deps.unitOfWork.run<AppError, DateOnly>(
      async (repositories) => {
        if (input.from !== undefined) return success(input.from);

        const first = await repositories.ledger.firstTradeDate();
        if (first.isFailure()) return first;

        return first.value === null
          ? failure(
              new BadRequestError(
                'Não há lançamentos: informe a data inicial com --desde=AAAA-MM-DD',
              ),
            )
          : success(first.value);
      },
    );

    if (from > today) {
      return yield* failure(new BadRequestError('A data inicial está no futuro'));
    }

    const codes = (input.codes ?? INDEX_HISTORY_CODES).filter((code) =>
      deps.indices.series.includes(code),
    );

    const calendar = yield* await deps.unitOfWork.run(async (repositories) => {
      const days = await repositories.businessDays.listBetween(
        addDays(monthStart(from), -10),
        today,
      );
      if (days.isFailure()) return days;

      return success(
        days.value.filter((day) => day.is_business_day).map((day) => day.calendar_date),
      );
    });

    const samples = new Map<IndexCode, IndexObservation[]>();
    const sources = new Map<IndexCode, string>();

    for (const window of yearlyWindows(from, today)) {
      const fetched = await deps.indices.fetchSeries(codes, window.from, window.to);

      if (fetched.isFailure()) {
        yield* await deps.unitOfWork.run(async (repositories) =>
          repositories.market.recordRun(
            runOf({
              source: deps.indices.id,
              kind: 'indices',
              date: today,
              startedAt,
              finishedAt: deps.clock.now().toISOString(),
              ok: false,
              error: fetched.value,
            }),
          ),
        );

        return yield* fetched;
      }

      for (const sample of fetched.value) {
        const bucket = samples.get(sample.index_code) ?? [];
        bucket.push({
          reference_date: sample.reference_date,
          unit: sample.unit,
          raw_value: sample.raw_value,
        });
        samples.set(sample.index_code, bucket);

        if (!sources.has(sample.index_code)) {
          sources.set(sample.index_code, sample.source ?? deps.indices.id);
        }
      }
    }

    const rows: IndexQuoteWrite[] = [];
    const written: Record<string, number> = {};

    for (const [code, observations] of samples) {
      const factors = dailyFactorsFrom(observations, calendar).filter(
        (factor) => factor.quote_date >= from,
      );
      written[code] = factors.length;

      for (const factor of factors) {
        rows.push({
          index_code: code,
          quote_date: factor.quote_date as DateOnly,
          daily_factor: factor.daily_factor,
          raw_value: factor.raw_value,
          source: sources.get(code) ?? deps.indices.id,
        });
      }
    }

    const empty = codes.filter((code) => (written[code] ?? 0) === 0);

    return yield* await deps.unitOfWork.run<AppError, LoadIndexHistoryResult>(
      async (repositories) => {
        for (let start = 0; start < rows.length; start += BATCH) {
          const batch = await repositories.market.upsertIndexQuotes(
            rows.slice(start, start + BATCH),
          );
          if (batch.isFailure()) return batch;
        }

        const portfolios = await repositories.portfolios.list({ includeArchived: false });
        if (portfolios.isFailure()) return portfolios;

        const enqueued = await repositories.outbox.enqueue(
          recalcEventsFor(
            portfolios.value.map((portfolio) => ({
              portfolio_id: portfolio.id,
              from_date: from,
            })),
            from,
          ),
        );
        if (enqueued.isFailure()) return enqueued;

        const recorded = await repositories.market.recordRun({
          ...runOf({
            source: deps.indices.id,
            kind: 'indices',
            date: today,
            startedAt,
            finishedAt: deps.clock.now().toISOString(),
            ok: true,
            items: rows.length,
            missing: empty.length,
          }),
          detail: { from, to: today, written, empty: [...empty] },
        });
        if (recorded.isFailure()) return recorded;

        return success({
          from,
          to: today,
          written,
          empty,
          recalculated: portfolios.value.map((portfolio) => portfolio.id),
        });
      },
    );
  });
