import { either } from '@patrimonio/shared';

import type { InstitutionRepository } from '../../interfaces/institution.repository.js';

export type InstitutionDeps = { readonly institutions: InstitutionRepository };

export const listInstitutions = (deps: InstitutionDeps) =>
  either(async function* () {
    return yield* await deps.institutions.list();
  });
