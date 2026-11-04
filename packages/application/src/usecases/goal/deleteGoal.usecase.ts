import { either, failure, success } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

export type DeleteGoalDeps = { readonly unitOfWork: UnitOfWork };

/**
 * Excluir o objetivo não toca em posição, lançamento nem patrimônio: ele só
 * mede a carteira, e some a medida.
 */
export const deleteGoal = (deps: DeleteGoalDeps) =>
  either(async function* (portfolioId: string) {
    return yield* await deps.unitOfWork.run<AppError, { deleted: true }>(
      async (repositories) => {
        const removed = await repositories.goals.remove(portfolioId);
        if (removed.isFailure()) return removed;

        if (!removed.value) {
          return failure(new NotFoundError('Esta carteira não tem objetivo'));
        }

        return success({ deleted: true as const });
      },
    );
  });
