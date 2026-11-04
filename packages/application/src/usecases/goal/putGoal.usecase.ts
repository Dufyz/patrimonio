import { parseReturnAssumption } from '@patrimonio/calc';
import type { DateOnly } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { InvalidParameterError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { GoalSaved, GoalWrite } from '../../interfaces/goal.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

export type PutGoalDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
};

export type PutGoalResult = GoalSaved;

/**
 * As duas regras que o objetivo precisa para a tela não mentir: a data é
 * futura — um objetivo nascido vencido só mostraria "prazo vencido" — e a
 * premissa é uma que a projeção entende. Compartilhada com a prévia, que
 * precisa recusar o mesmo que o `PUT` recusaria.
 */
export const validateGoal = (
  write: GoalWrite,
  today: DateOnly,
): Either<InvalidParameterError, void> => {
  if (write.target_date <= today) {
    return failure(new InvalidParameterError('A data do objetivo precisa ser futura'));
  }

  if (
    write.return_assumption !== null &&
    parseReturnAssumption(write.return_assumption) === null
  ) {
    return failure(
      new InvalidParameterError(
        `A premissa "${write.return_assumption}" não foi entendida: use, por exemplo, IPCA+6 ou 6`,
      ),
    );
  }

  return success(undefined);
};

/**
 * Cria ou edita o objetivo da carteira: ela tem no máximo um, e o mesmo
 * formulário serve aos dois casos. Editar mantém o dia de criação, que é de
 * onde a barra mede "esperado hoje".
 */
export const putGoal = (deps: PutGoalDeps) =>
  either(async function* (portfolioId: string, write: GoalWrite) {
    yield* validateGoal(write, deps.clock.today());

    return yield* await deps.unitOfWork.run<AppError, PutGoalResult>(
      async (repositories) => {
        const found = await repositories.portfolios.findById(portfolioId);
        if (found.isFailure()) return found;
        if (found.value === null || found.value.archived_at !== null) {
          return failure(new NotFoundError(`Carteira ${portfolioId} não encontrada`));
        }

        return repositories.goals.save(portfolioId, write);
      },
    );
  });
