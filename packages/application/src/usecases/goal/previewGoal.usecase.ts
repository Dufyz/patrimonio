import type { DateOnly } from '@patrimonio/domain';
import { either, failure } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { GoalRepository, GoalWrite } from '../../interfaces/goal.repository.js';
import { evaluate, inflationOf } from './getGoals.usecase.js';
import type { GoalResult } from './getGoals.usecase.js';
import { validateGoal } from './putGoal.usecase.js';

export type PreviewGoalDeps = {
  readonly goals: GoalRepository;
  readonly clock: Clock;
};

export type PreviewGoalInput = GoalWrite & {
  readonly portfolio_id: string;
  readonly on_date?: DateOnly | undefined;
};

/**
 * O objetivo como ficaria, projetado pela mesma conta da tela e sobre o mesmo
 * fechamento: é o "depois" do modal. Recusa o que o `PUT` recusaria, para a
 * prévia nunca mostrar um resultado que não dá para gravar.
 */
export const previewGoal = (deps: PreviewGoalDeps) =>
  either(async function* (input: PreviewGoalInput) {
    const reference = input.on_date ?? deps.clock.today();

    yield* validateGoal(input, reference);

    const snapshot = yield* await deps.goals.snapshot({
      portfolio_id: input.portfolio_id,
      on_date: reference,
      draft: {
        name: input.name,
        target_amount: input.target_amount,
        target_date: input.target_date,
        return_assumption: input.return_assumption,
        amount_in_today_brl: input.amount_in_today_brl,
      },
    });

    const row = snapshot.goal;

    if (snapshot.scope_portfolio === null || row === null) {
      return yield* failure(
        new NotFoundError(`Carteira ${input.portfolio_id} não encontrada`),
      );
    }

    const result: GoalResult = evaluate(
      row,
      reference,
      undefined,
      inflationOf(snapshot.inflation, reference),
    );

    return result;
  });
