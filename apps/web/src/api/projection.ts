import { projectionSchema } from '@patrimonio/contracts';
import type { ProjectionResource, PutProjectionPlanBody } from '@patrimonio/contracts';

import { request } from './client.js';

/** PRJ-02/04/06 · `GET /api/projection` e a troca do plano da carteira. */
export const fetchProjection = (
  portfolioId: string | null,
  horizon: number,
  signal?: AbortSignal,
): Promise<ProjectionResource> => {
  const search = new URLSearchParams({ horizon: String(horizon) });
  if (portfolioId !== null) search.set('portfolio_id', portfolioId);

  return request(
    `/api/projection?${search.toString()}`,
    projectionSchema,
    signal === undefined ? {} : { signal },
  );
};

const accept = { parse: (value: unknown): unknown => value };

export const putProjectionPlan = (
  portfolioId: string,
  body: PutProjectionPlanBody,
  /** `version` que a tela viu: o servidor recusa com 409 se o plano mudou. */
  ifMatch?: string,
): Promise<unknown> =>
  request(`/api/portfolios/${portfolioId}/projection-plan`, accept, {
    method: 'PUT',
    headers: {
      'Idempotency-Key': globalThis.crypto.randomUUID(),
      ...(ifMatch === undefined ? {} : { 'If-Match': `"${ifMatch}"` }),
    },
    body: JSON.stringify(body),
  });
