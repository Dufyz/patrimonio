import type { getGoals } from '@patrimonio/application';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/**
 * A tela de Objetivos, numa rota só. Ela é uma pergunta — o ritmo atual chega
 * lá? — e o progresso, as trajetórias e a tabela de aportes respondem a ela
 * sobre o mesmo fechamento e a mesma premissa. A escrita do objetivo (criar,
 * editar, encerrar) é outra operação, com outro corpo, e chega com T-10.
 */
export type GoalDeps = {
  readonly usecases: {
    readonly getGoals: ReturnType<typeof getGoals>;
  };
};

export type GoalController = {
  readonly goals: RequestHandler;
};

type GoalQuery = {
  readonly portfolio_id: string;
  readonly on_date?: string;
  readonly rates?: string;
};

/**
 * `id:6,id:5.5` → `{ id: '6', id: '5.5' }`. O schema já garantiu o formato:
 * aqui só se desfaz a lista, sem reinterpretar o número.
 */
const parseRates = (value: string | undefined): Record<string, string> | undefined => {
  if (value === undefined || value === '') return undefined;

  return Object.fromEntries(
    value.split(',').map((part) => {
      const [id = '', rate = ''] = part.split(':');
      return [id, rate] as const;
    }),
  );
};

export const createGoalController = (deps: GoalDeps): GoalController => ({
  goals: async (request, response) => {
    const query = validatedQuery<GoalQuery>(request);
    const rates = parseRates(query?.rates);

    const result = await deps.usecases.getGoals({
      portfolio_id: String(query?.portfolio_id),
      ...(query?.on_date === undefined ? {} : { on_date: query.on_date }),
      ...(rates === undefined ? {} : { rates }),
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json(result.value);
  },
});
