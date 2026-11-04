import { addDays } from '@patrimonio/domain';
import type { DateOnly, MarketSourceRunDraft } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { FormatChangedError, isFormatChangedError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { InstrumentCatalogSource } from '../../interfaces/market_data.js';
import type { InstrumentWrite } from '../../interfaces/instrument_catalog.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

/**
 * A fonte e o tipo com que a carga do catálogo grava a execução. O tipo é
 * `cotahist`, e a fonte leva o sufixo para a tela de dados de mercado separar a
 * carga do catálogo da carga de histórico de preço.
 */
export const INSTRUMENT_CATALOG_SOURCE = 'cotahist-catalog';

/** O papel que não negocia há mais dias que isto, contados do fim do arquivo, é inativo. */
export const INACTIVE_AFTER_DAYS = 30;

/** Quantos papéis vão por escrita: o catálogo inteiro numa transação, em lotes. */
const BATCH = 1000;

/** Depois disto sem carga, o estágio de mercado a repete. */
export const CATALOG_STALE_AFTER_DAYS = 30;

export type RefreshInstrumentCatalogInput = {
  /** Recarrega mesmo que a última carga seja recente. */
  readonly force?: boolean | undefined;
  readonly staleAfterDays?: number | undefined;
};

export type RefreshInstrumentCatalogResult = {
  readonly skipped: boolean;
  readonly created: number;
  readonly updated: number;
  readonly deactivated: number;
  readonly lines_read: number;
  readonly last_date: DateOnly | null;
};

export type RefreshInstrumentCatalogDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly instruments: InstrumentCatalogSource;
};

const NOTHING: RefreshInstrumentCatalogResult = {
  skipped: true,
  created: 0,
  updated: 0,
  deactivated: 0,
  lines_read: 0,
  last_date: null,
};

const failedRun = (
  startedAt: string,
  finishedAt: string,
  date: DateOnly,
  error: AppError,
): MarketSourceRunDraft => ({
  source: INSTRUMENT_CATALOG_SOURCE,
  kind: 'cotahist',
  reference_date: date,
  started_at: startedAt,
  finished_at: finishedAt,
  ok: false,
  requests: 1,
  items: 0,
  missing: 0,
  error: error.message,
  detail: isFormatChangedError(error)
    ? { field: error.field, received: error.received }
    : null,
});

/**
 * Carrega o catálogo de papéis a partir da fonte e o reconcilia com o que há no
 * banco: o que veio é gravado, o que a fonte não trouxe mais fica inativo.
 *
 * Recarregar não duplica nem apaga: o papel inativo continua no catálogo para
 * quem o teve, e volta a ser ativo se a fonte o trouxer de novo.
 *
 * Sem `force`, a carga só roda quando a última tem mais de `staleAfterDays` ou
 * não existe — é isso que torna a atualização mensal sem uma fila própria: o
 * estágio de mercado chama este caso de uso todo dia, e ele quase sempre sai
 * cedo.
 *
 * Formato mudado na fonte falha o caso de uso e grava a execução com o campo e
 * o trecho recebido. Fonte fora do ar também grava a execução, e o erro volta.
 */
export const refreshInstrumentCatalog = (deps: RefreshInstrumentCatalogDeps) =>
  either(async function* (input: RefreshInstrumentCatalogInput = {}) {
    const startedAt = deps.clock.now().toISOString();
    const today = deps.clock.today();

    if (input.force !== true) {
      const last = yield* await deps.unitOfWork.run(async (repositories) =>
        repositories.market.lastRunOf(INSTRUMENT_CATALOG_SOURCE, 'cotahist'),
      );

      const staleAfter = input.staleAfterDays ?? CATALOG_STALE_AFTER_DAYS;
      const threshold = addDays(today, -staleAfter);

      if (last !== null && last.ok && last.finished_at.slice(0, 10) > threshold) {
        return NOTHING;
      }
    }

    const fetched = await deps.instruments.fetchInstruments();

    // Um arquivo lido sem nenhum papel é o arquivo errado, e tratá-lo como
    // catálogo vazio desativaria todos os papéis do banco.
    const problem: AppError | null = fetched.isFailure()
      ? fetched.value
      : fetched.value.instruments.length === 0
        ? new FormatChangedError(
            fetched.value.source,
            'arquivo',
            'não tem nenhum papel reconhecido',
            `${fetched.value.lines_read} linhas lidas`,
          )
        : null;

    if (problem !== null) {
      const recorded = await deps.unitOfWork.run(async (repositories) =>
        repositories.market.recordRun(
          failedRun(startedAt, deps.clock.now().toISOString(), today, problem),
        ),
      );
      if (recorded.isFailure()) return yield* recorded;

      return yield* failure(problem);
    }

    if (fetched.isFailure()) return yield* fetched;

    const {
      instruments,
      source,
      last_date: lastDate,
      lines_read: linesRead,
    } = fetched.value;

    const active = (lastTrade: DateOnly): boolean =>
      lastDate === null || lastTrade >= addDays(lastDate, -INACTIVE_AFTER_DAYS);

    const rows: InstrumentWrite[] = instruments.map((item) => ({
      ticker: item.ticker,
      name: item.name,
      b3_type: item.b3_type,
      maturity_date: null,
      source,
      active: active(item.last_trade_date),
      last_trade_date: item.last_trade_date,
    }));

    const counts = yield* await deps.unitOfWork.run<
      AppError,
      { readonly created: number; readonly updated: number; readonly deactivated: number }
    >(async (repositories) => {
      let created = 0;
      let updated = 0;

      for (let start = 0; start < rows.length; start += BATCH) {
        const written = await repositories.instruments.upsertMany(
          rows.slice(start, start + BATCH),
        );
        if (written.isFailure()) return written;

        created += written.value.created;
        updated += written.value.updated;
      }

      const deactivated = await repositories.instruments.deactivateMissing(
        source,
        rows.map((row) => row.ticker),
      );
      if (deactivated.isFailure()) return deactivated;

      const recorded = await repositories.market.recordRun({
        source: INSTRUMENT_CATALOG_SOURCE,
        kind: 'cotahist',
        reference_date: today,
        started_at: startedAt,
        finished_at: deps.clock.now().toISOString(),
        ok: true,
        requests: 1,
        items: rows.length,
        missing: deactivated.value,
        error: null,
        detail: {
          created,
          updated,
          deactivated: deactivated.value,
          lines_read: linesRead,
          last_date: lastDate,
        },
      });
      if (recorded.isFailure()) return recorded;

      return success({ created, updated, deactivated: deactivated.value });
    });

    return {
      skipped: false,
      created: counts.created,
      updated: counts.updated,
      deactivated: counts.deactivated,
      lines_read: linesRead,
      last_date: lastDate,
    } satisfies RefreshInstrumentCatalogResult;
  });
