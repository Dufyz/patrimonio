import { goalsSchema } from '@patrimonio/contracts';
import type { GoalsResource } from '@patrimonio/contracts';

import { request } from './client.js';

/**
 * A tela de Objetivos inteira, numa chamada: `GET /api/goals` responde
 * progresso, projeção, trajetórias e tabela de aportes sobre o mesmo
 * fechamento e a mesma premissa.
 */
export type GoalsQuery = {
  readonly portfolioId: string;
  /** Taxa ao ano, em %, trocada por objetivo. Vazio usa a premissa guardada. */
  readonly rates?: Readonly<Record<string, string>> | undefined;
};

export const fetchGoals = async (
  query: GoalsQuery,
  signal?: AbortSignal,
): Promise<GoalsResource> => {
  const search = new URLSearchParams();
  search.set('portfolio_id', query.portfolioId);

  const rates = Object.entries(query.rates ?? {});
  if (rates.length > 0) {
    search.set('rates', rates.map(([id, rate]) => `${id}:${rate}`).join(','));
  }

  const suffix = search.toString();

  return request(
    `/api/goals${suffix === '' ? '' : `?${suffix}`}`,
    goalsSchema,
    signal === undefined ? {} : { signal },
  );
};
