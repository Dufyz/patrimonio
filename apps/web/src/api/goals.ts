import {
  goalsOverviewSchema,
  goalsSchema,
  previewGoalResponseSchema,
} from '@patrimonio/contracts';
import type {
  GoalResource,
  GoalsOverviewResource,
  GoalsResource,
} from '@patrimonio/contracts';

import { request } from './client.js';

/**
 * A tela de Objetivos inteira, numa chamada: `GET /api/goals` responde
 * progresso, projeção, trajetórias e tabela de aportes sobre o mesmo
 * fechamento e a mesma premissa.
 */
export type GoalsQuery = {
  readonly portfolioId: string;
  /** Taxa ao ano, em %, no lugar da premissa guardada. Ausente usa a premissa. */
  readonly rate?: string | null | undefined;
};

export const fetchGoals = async (
  query: GoalsQuery,
  signal?: AbortSignal,
): Promise<GoalsResource> => {
  const search = new URLSearchParams();
  search.set('portfolio_id', query.portfolioId);

  if (query.rate !== undefined && query.rate !== null) {
    search.set('rate', query.rate);
  }

  const suffix = search.toString();

  return request(
    `/api/goals${suffix === '' ? '' : `?${suffix}`}`,
    goalsSchema,
    signal === undefined ? {} : { signal },
  );
};

/**
 * Os objetivos de todas as carteiras, numa chamada: `GET /api/goals/overview`
 * soma o necessário, reparte o aporte e diz quando as metas fecham.
 */
export type GoalsOverviewQuery = {
  /** O aporte mensal total a distribuir. Ausente vale o necessário. */
  readonly budget?: string | null | undefined;
  readonly distribution?: 'proportional' | 'priority' | undefined;
  readonly cascade?: boolean | undefined;
  readonly priority?: readonly string[] | undefined;
};

export const fetchGoalsOverview = async (
  query: GoalsOverviewQuery,
  signal?: AbortSignal,
): Promise<GoalsOverviewResource> => {
  const search = new URLSearchParams();

  if (query.budget !== undefined && query.budget !== null) {
    search.set('budget', query.budget);
  }
  if (query.distribution !== undefined) search.set('distribution', query.distribution);
  if (query.cascade !== undefined) search.set('cascade', String(query.cascade));
  if (query.priority !== undefined && query.priority.length > 0) {
    search.set('priority', query.priority.join(','));
  }

  const suffix = search.toString();

  return request(
    `/api/goals/overview${suffix === '' ? '' : `?${suffix}`}`,
    goalsOverviewSchema,
    signal === undefined ? {} : { signal },
  );
};

/**
 * O que o formulário escreve num objetivo. A carteira tem no máximo um, então a
 * rota é a da carteira e o mesmo `PUT` cria ou edita.
 */
export type GoalBody = {
  readonly name: string;
  readonly target_amount: string;
  readonly target_date: string;
  readonly return_assumption: string | null;
  readonly amount_in_today_brl: boolean;
};

const accept = { parse: (value: unknown): unknown => value };

export const putGoal = (portfolioId: string, body: GoalBody): Promise<unknown> =>
  request(`/api/portfolios/${portfolioId}/goal`, accept, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const deleteGoal = (portfolioId: string): Promise<unknown> =>
  request(`/api/portfolios/${portfolioId}/goal`, accept, { method: 'DELETE' });

/** O objetivo do formulário projetado como ficaria, sem gravar: o "depois" do modal. */
export const previewGoal = async (
  portfolioId: string,
  body: GoalBody,
  signal?: AbortSignal,
): Promise<GoalResource> => {
  const response = await request(
    `/api/portfolios/${portfolioId}/goal/preview`,
    previewGoalResponseSchema,
    {
      method: 'POST',
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    },
  );

  return response.goal;
};
