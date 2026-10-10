import type {
  createInstitution,
  deleteInstitution,
  listInstitutions,
  updateInstitution,
} from '@patrimonio/application';
import type { CreateInstitutionBody, UpdateInstitutionBody } from '@patrimonio/contracts';
import type { RequestHandler } from 'express';

import { sendFailure } from '../middleware/respond.js';

export type InstitutionDeps = {
  readonly usecases: {
    readonly listInstitutions: ReturnType<typeof listInstitutions>;
    readonly createInstitution: ReturnType<typeof createInstitution>;
    readonly updateInstitution: ReturnType<typeof updateInstitution>;
    readonly deleteInstitution: ReturnType<typeof deleteInstitution>;
  };
};

export type InstitutionController = {
  readonly list: RequestHandler;
  readonly create: RequestHandler;
  readonly update: RequestHandler;
  readonly remove: RequestHandler;
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

  create: async (request, response) => {
    const body = request.body as CreateInstitutionBody;
    const result = await deps.usecases.createInstitution(body);

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response
      .status(201)
      .json({ institution: result.value, message: 'Instituição criada' });
  },

  update: async (request, response) => {
    const body = request.body as UpdateInstitutionBody;
    const result = await deps.usecases.updateInstitution(
      String(request.params['institution_id']),
      body,
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response
      .status(200)
      .json({ institution: result.value, message: 'Instituição atualizada' });
  },

  remove: async (request, response) => {
    const result = await deps.usecases.deleteInstitution(
      String(request.params['institution_id']),
    );

    if (result.isFailure()) {
      sendFailure(request, response, result.value);
      return;
    }

    response.status(200).json({ result: result.value, message: 'Instituição excluída' });
  },
});
