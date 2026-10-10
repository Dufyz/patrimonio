import type { Portfolio } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { ConflictError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type {
  PortfolioWrite,
  StrategyTargetWrite,
} from '../../interfaces/portfolio.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { validateTargets } from './createPortfolio.usecase.js';

export type UpdatePortfolioInput = PortfolioWrite & {
  readonly allocation_targets?: readonly StrategyTargetWrite[] | undefined;
};

export type UpdatePortfolioDeps = { readonly unitOfWork: UnitOfWork };

export const updatePortfolio = (deps: UpdatePortfolioDeps) =>
  either(async function* (id: string, input: UpdatePortfolioInput) {
    const targets = input.allocation_targets;
    if (targets !== undefined) yield* validateTargets(targets);

    const patch: PortfolioWrite = {
      name: input.name,
      benchmark_id: input.benchmark_id,
      sort_order: input.sort_order,
    };

    return yield* await deps.unitOfWork.run<AppError, Portfolio>(async (repositories) => {
      if (patch.name !== undefined) {
        const sameName = await repositories.portfolios.findByName(patch.name);
        if (sameName.isFailure()) return sameName;

        if (
          sameName.value !== null &&
          sameName.value.id !== id &&
          sameName.value.archived_at === null
        ) {
          return failure(
            new ConflictError(`Já existe uma carteira chamada ${patch.name}`),
          );
        }
      }

      const updated = await repositories.portfolios.update(id, patch);
      if (updated.isFailure()) return updated;
      if (updated.value === null) {
        return failure(new NotFoundError(`Carteira ${id} não encontrada`));
      }

      if (targets !== undefined) {
        const saved = await repositories.portfolios.replaceTargets(id, targets);
        if (saved.isFailure()) return saved;
      }

      return success(updated.value);
    });
  });
