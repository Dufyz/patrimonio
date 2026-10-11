import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { TreasurySource } from '../../interfaces/market_data.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { runOf } from './collectMarketData.usecase.js';
import { writeTreasuryCatalog } from './treasuryCatalog.js';

/**
 * A carga do catálogo do Tesouro Direto: os títulos à venda hoje, sem esperar a
 * coleta diária. É o passo do `bootstrap` que faz o Tesouro aparecer na busca de
 * uma instalação nova.
 */
export type LoadTreasuryCatalogResult = {
  readonly titles: number;
  readonly source: string;
};

export type LoadTreasuryCatalogDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly treasury: TreasurySource;
};

export const loadTreasuryCatalog = (deps: LoadTreasuryCatalogDeps) =>
  either(async function* () {
    const today = deps.clock.today();
    const startedAt = deps.clock.now().toISOString();

    const fetched = await deps.treasury.fetchQuotes(today);

    if (fetched.isFailure()) {
      yield* await deps.unitOfWork.run(async (repositories) =>
        repositories.market.recordRun(
          runOf({
            source: 'tesouro-direto',
            kind: 'treasury',
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

    const { quotes, source, source_kind: sourceKind } = fetched.value;

    if (quotes.length === 0) {
      return yield* failure(
        new BadRequestError('A fonte do Tesouro não devolveu nenhum título'),
      );
    }

    return yield* await deps.unitOfWork.run<AppError, LoadTreasuryCatalogResult>(
      async (repositories) => {
        const written = await writeTreasuryCatalog(repositories, quotes);
        if (written.isFailure()) return written;

        const recorded = await repositories.market.recordRun(
          runOf({
            source,
            kind: 'treasury',
            date: today,
            startedAt,
            finishedAt: deps.clock.now().toISOString(),
            ok: true,
            sourceKind: sourceKind === 'none' ? null : sourceKind,
            items: quotes.length,
          }),
        );
        if (recorded.isFailure()) return recorded;

        return success({ titles: quotes.length, source });
      },
    );
  });
