import type { StrategyTarget } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { StrategyTargetWrite } from '../../interfaces/portfolio.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { validateTargets } from './createPortfolio.usecase.js';

export type PutStrategyDeps = { readonly unitOfWork: UnitOfWork };

/**
 * O alvo inteiro é substituído de uma vez. A soma só precisa valer no commit, e
 * é por isso que o trigger do banco é diferido: verificar a cada linha tornaria
 * impossível trocar 35/25/40 por 30/30/40.
 */
export const putStrategy = (deps: PutStrategyDeps) =>
  either(async function* (
    portfolioId: string,
    targets: readonly StrategyTargetWrite[],
  ) {
    yield* validateTargets(targets);

    return yield* await deps.unitOfWork.run<AppError, StrategyTarget[]>(
      async (repositories) => {
        const portfolio = await repositories.portfolios.findById(portfolioId);
        if (portfolio.isFailure()) return portfolio;
        if (portfolio.value === null) {
          return failure(new NotFoundError(`Carteira ${portfolioId} não encontrada`));
        }

        const saved = await repositories.portfolios.replaceTargets(portfolioId, targets);
        if (saved.isFailure()) return saved;

        return success(saved.value);
      },
    );
  });
