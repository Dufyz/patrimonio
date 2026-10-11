import type { listInstitutions } from '@patrimonio/application';
import type { RequestHandler } from 'express';

import { sendFailure } from '../middleware/respond.js';

export type InstitutionDeps = {
  readonly usecases: {
    readonly listInstitutions: ReturnType<typeof listInstitutions>;
  };
};

export type InstitutionController = {
  readonly list: RequestHandler;
};

export const createInstitutionController = (
  deps: InstitutionDeps,
): InstitutionController => ({
  list: async (request, response) => {
    const result = await deps.usecases.listInstitutions();

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ institutions: result.value });
  },
});
