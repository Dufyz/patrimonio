import { MarketDataUnavailableError } from '@patrimonio/application';
import type { AppError, Clock, UnitOfWork } from '@patrimonio/application';
import { fetchInstitutionNames, loadInstitutions } from '@patrimonio/db';
import type { Sql } from '@patrimonio/db';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

/** A fonte e o tipo sob os quais a carga de instituições fica registrada. */
export const INSTITUTIONS_SOURCE = 'institutions';

/** Depois disto sem carga, a sincronização recarrega as instituições. */
export const INSTITUTIONS_STALE_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A recarga das instituições (STR do Banco Central e CVM). Sem `force`, só roda
 * quando a última carga bem-sucedida tem mais de 30 dias; o botão "Atualizar
 * agora" força. A execução fica registrada, ok ou falha, e uma fonte fora do ar
 * devolve falha sem derrubar quem chamou.
 */
export const createInstitutionsRefresher =
  (deps: { readonly unitOfWork: UnitOfWork; readonly clock: Clock; readonly sql: Sql }) =>
  async (input: {
    readonly force: boolean;
  }): Promise<Either<AppError, { readonly inserted: number; readonly skipped: boolean }>> => {
    const startedAt = deps.clock.now().toISOString();

    if (!input.force) {
      const last = await deps.unitOfWork.run((repositories) =>
        repositories.market.lastRunOf(INSTITUTIONS_SOURCE, 'cotahist'),
      );

      if (
        last.isSuccess() &&
        last.value !== null &&
        last.value.ok &&
        deps.clock.now().getTime() - Date.parse(last.value.finished_at) <
          INSTITUTIONS_STALE_AFTER_DAYS * DAY_MS
      ) {
        return success({ inserted: 0, skipped: true });
      }
    }

    const record = (ok: boolean, items: number, error: string | null) =>
      deps.unitOfWork.run((repositories) =>
        repositories.market.recordRun({
          source: INSTITUTIONS_SOURCE,
          kind: 'cotahist',
          reference_date: deps.clock.today(),
          started_at: startedAt,
          finished_at: deps.clock.now().toISOString(),
          ok,
          source_kind: ok ? 'primary' : null,
          requests: 2,
          items,
          missing: 0,
          error,
          detail: null,
        }),
      );

    try {
      const { names } = await fetchInstitutionNames();
      const loaded = await loadInstitutions(deps.sql, names);

      await record(true, loaded.received, null);

      return success({ inserted: loaded.inserted, skipped: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await record(false, 0, message);

      return failure(new MarketDataUnavailableError(`instituições: ${message}`));
    }
  };
