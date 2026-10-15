import { either } from '@patrimonio/shared';

import type { Clock } from '../../interfaces/clock.js';
import type { PriceHistorySource } from '../../interfaces/market_data.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { loadPriceHistory } from './loadPriceHistory.usecase.js';

/**
 * O histórico de cotações **desde a estreia** de cada papel, carregado sozinho.
 *
 * A fila é o próprio cadastro: ativo de bolsa com `history_synced_at` nulo está
 * pendente. Cada rodada pega os pendentes, lê o arquivo anual do COTAHIST do ano
 * corrente para trás e, a cada ano, tira da lista o papel que deixou de aparecer
 * — a estreia ficou para trás. Ao fim, marca todos como carregados. Nenhuma carga
 * manual (`seed:cotahist`) é necessária; o comando continua existindo para
 * recarregar um ano específico.
 *
 * Duas salvaguardas contra o arquivo incompleto:
 * - **Ano ainda não publicado** (janeiro) não conta como ausência: segue para o
 *   anterior sem concluir nada sobre o papel.
 * - **Papel que nunca apareceu** em dois anos seguidos é dado como sem histórico
 *   no arquivo e sai da fila, para não baixar três décadas por causa de um
 *   ticker que a B3 não negocia.
 *
 * Falha da fonte devolve falha e **não marca nada**: a rodada seguinte recomeça.
 * O que já foi gravado fica — a escrita é `UPSERT` por (ativo, data).
 */
export type SyncPriceHistoryInput = {
  /** Quantos papéis pendentes entram na rodada. */
  readonly limit?: number | undefined;
};

export type SyncPriceHistoryResult = {
  readonly synced: readonly string[];
  readonly years_read: number;
  readonly prices_written: number;
};

export type SyncPriceHistoryDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly history: PriceHistorySource;
};

const FIRST_YEAR = 1994;
const GIVE_UP_AFTER = 2;

export const syncPriceHistory = (deps: SyncPriceHistoryDeps) => {
  const load = loadPriceHistory(deps);

  return either(async function* (input: SyncPriceHistoryInput) {
    const pending = yield* await deps.unitOfWork.run((repositories) =>
      repositories.market.assetsPendingHistory(input.limit ?? 50),
    );

    if (pending.length === 0) {
      return { synced: [], years_read: 0, prices_written: 0 };
    }

    const currentYear = Number(deps.clock.today().slice(0, 4));
    const remaining = new Map(
      pending.map((asset) => [asset.ticker.toUpperCase(), asset]),
    );
    const seen = new Set<string>();
    const absent = new Map<string, number>();

    let yearsRead = 0;
    let written = 0;

    for (let year = currentYear; year >= FIRST_YEAR && remaining.size > 0; year -= 1) {
      const result = yield* await load({
        from_year: year,
        to_year: year,
        tickers: [...remaining.keys()],
      });

      yearsRead += 1;
      written += result.prices_written;

      // Arquivo do ano ainda não publicado: nada a concluir sobre ninguém.
      if (result.unavailable_years.includes(year)) continue;

      const missing = new Set(result.missing.map((ticker) => ticker.toUpperCase()));

      for (const ticker of [...remaining.keys()]) {
        if (!missing.has(ticker)) {
          seen.add(ticker);
          absent.delete(ticker);
          continue;
        }

        const streak = (absent.get(ticker) ?? 0) + 1;
        absent.set(ticker, streak);

        if (seen.has(ticker) || streak >= GIVE_UP_AFTER) remaining.delete(ticker);
      }
    }

    yield* await deps.unitOfWork.run((repositories) =>
      repositories.market.markHistorySynced(pending.map((asset) => asset.asset_id)),
    );

    return {
      synced: pending.map((asset) => asset.ticker),
      years_read: yearsRead,
      prices_written: written,
    } satisfies SyncPriceHistoryResult;
  });
};
