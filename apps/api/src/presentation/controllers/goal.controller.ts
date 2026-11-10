import type {
  deleteGoal,
  getGoals,
  getGoalsOverview,
  previewGoal,
  putGoal,
} from '@patrimonio/application';
import type { PreviewGoalBody, PutGoalBody } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/**
 * A tela de Objetivos, numa rota só. Ela é uma pergunta — o ritmo atual chega
 * lá? — e o progresso, as trajetórias e a tabela de aportes respondem a ela
 * sobre o mesmo fechamento e a mesma premissa. A escrita do objetivo é outra
 * operação, com outro corpo: `PUT` cria ou edita (a carteira tem no máximo um),
 * `DELETE` exclui, e a prévia projeta o que o formulário descreve sem gravar.
 */
export type GoalDeps = {
  readonly usecases: {
    readonly getGoals: ReturnType<typeof getGoals>;
    readonly getGoalsOverview: ReturnType<typeof getGoalsOverview>;
    readonly putGoal: ReturnType<typeof putGoal>;
    readonly deleteGoal: ReturnType<typeof deleteGoal>;
    readonly previewGoal: ReturnType<typeof previewGoal>;
  };
};

export type GoalController = {
  readonly goals: RequestHandler;
  readonly overview: RequestHandler;
  readonly put: RequestHandler;
  readonly remove: RequestHandler;
  readonly preview: RequestHandler;
};

type GoalQuery = {
  readonly portfolio_id: string;
  readonly on_date?: string;
  readonly rate?: string;
  readonly nominal_rate?: string;
  readonly monthly?: string;
};

type OverviewQuery = {
  readonly on_date?: string;
  readonly budget?: string;
  readonly distribution?: 'proportional' | 'priority';
  readonly cascade?: boolean;
  readonly priority?: readonly string[];
  readonly rates?: Readonly<Record<string, string>>;
};

export const createGoalController = (deps: GoalDeps): GoalController => ({
  goals: async (request, response) => {
    const query = validatedQuery<GoalQuery>(request);
    const result = await deps.usecases.getGoals({
      portfolio_id: String(query?.portfolio_id),
      ...(query?.on_date === undefined ? {} : { on_date: query.on_date }),
      ...(query?.rate === undefined ? {} : { rate: query.rate }),
      ...(query?.nominal_rate === undefined ? {} : { nominal_rate: query.nominal_rate }),
      ...(query?.monthly === undefined ? {} : { monthly: query.monthly }),
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json(result.value);
  },

  overview: async (request, response) => {
    const query = validatedQuery<OverviewQuery>(request);
    const result = await deps.usecases.getGoalsOverview({
      ...(query?.on_date === undefined ? {} : { on_date: query.on_date }),
      ...(query?.budget === undefined ? {} : { budget: query.budget }),
      ...(query?.distribution === undefined ? {} : { distribution: query.distribution }),
      ...(query?.cascade === undefined ? {} : { cascade: query.cascade }),
      ...(query?.priority === undefined ? {} : { priority: query.priority }),
      ...(query?.rates === undefined ? {} : { rates: query.rates }),
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json(result.value);
  },

  put: async (request, response) => {
    const body = request.body as PutGoalBody;
    const result = await deps.usecases.putGoal(
      String(request.params['portfolio_id']),
      body,
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    const { created, ...goal } = result.value;

    response
      .status(created ? 201 : 200)
      .json({ goal, message: created ? 'Objetivo criado' : 'Objetivo atualizado' });
  },

  remove: async (request, response) => {
    const result = await deps.usecases.deleteGoal(String(request.params['portfolio_id']));

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ message: 'Objetivo excluído' });
  },

  preview: async (request, response) => {
    const body = request.body as PreviewGoalBody;
    const result = await deps.usecases.previewGoal({
      ...body,
      portfolio_id: String(request.params['portfolio_id']),
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ goal: result.value });
  },
});
