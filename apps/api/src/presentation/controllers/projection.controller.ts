import type { getProjection, putProjectionPlan } from '@patrimonio/application';
import type { PutProjectionPlanBody } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure, validatedQuery } from '../middleware/respond.js';

/** PRJ-02/04/06 · A Projeção lê o plano e o motor; a escrita troca o plano da carteira. */
export type ProjectionDeps = {
  readonly usecases: {
    readonly getProjection: ReturnType<typeof getProjection>;
    readonly putProjectionPlan: ReturnType<typeof putProjectionPlan>;
  };
};

export type ProjectionController = {
  readonly get: RequestHandler;
  readonly put: RequestHandler;
};

type ProjectionQuery = { readonly portfolio_id?: string; readonly horizon?: number };

export const createProjectionController = (
  deps: ProjectionDeps,
): ProjectionController => ({
  get: async (request, response) => {
    const query = validatedQuery<ProjectionQuery>(request);
    const result = await deps.usecases.getProjection({
      portfolio_id: query?.portfolio_id,
      horizon_months: query?.horizon,
    });

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.json(result.value);
  },

  put: async (request, response) => {
    const body = request.body as PutProjectionPlanBody;
    const result = await deps.usecases.putProjectionPlan(
      String(request.params['portfolio_id']),
      {
        expected_return_pct: body.expected_return_pct,
        rules: body.rules,
      },
      request.header('If-Match')?.replace(/^W\//, '').replace(/"/g, '').trim(),
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ message: 'Plano de projeção salvo' });
  },
});
