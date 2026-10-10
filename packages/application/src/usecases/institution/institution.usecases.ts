import type { Institution } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { ConflictError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type {
  InstitutionDraft,
  InstitutionRepository,
  InstitutionWrite,
} from '../../interfaces/institution.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

export type InstitutionDeps = { readonly institutions: InstitutionRepository };
export type InstitutionWriteDeps = { readonly unitOfWork: UnitOfWork };

export const listInstitutions = (deps: InstitutionDeps) =>
  either(async function* () {
    return yield* await deps.institutions.list();
  });

export const createInstitution = (deps: InstitutionWriteDeps) =>
  either(async function* (draft: InstitutionDraft) {
    return yield* await deps.unitOfWork.run<AppError, Institution>(
      async (repositories) => {
        const existing = await repositories.institutions.findByName(draft.name);
        if (existing.isFailure()) return existing;
        if (existing.value !== null) {
          return failure(
            new ConflictError(`Já existe uma instituição chamada ${draft.name}`),
          );
        }

        return repositories.institutions.create(draft);
      },
    );
  });

export const updateInstitution = (deps: InstitutionDeps) =>
  either(async function* (id: string, patch: InstitutionWrite) {
    const updated = yield* await deps.institutions.update(id, patch);

    if (updated === null) {
      return yield* failure(new NotFoundError(`Instituição ${id} não encontrada`));
    }

    return updated;
  });

/**
 * Excluir instituição com lançamento é bloqueado, e a mensagem traz a contagem
 * do que impede: "41 lançamentos" é acionável, "violação de chave estrangeira"
 * manda o usuário abrir o banco.
 */
export const deleteInstitution = (deps: InstitutionWriteDeps) =>
  either(async function* (id: string) {
    return yield* await deps.unitOfWork.run<AppError, { readonly id: string }>(
      async (repositories) => {
        const found = await repositories.institutions.findById(id);
        if (found.isFailure()) return found;
        if (found.value === null) {
          return failure(new NotFoundError(`Instituição ${id} não encontrada`));
        }

        const usage = await repositories.institutions.usage(id);
        if (usage.isFailure()) return usage;

        if (usage.value.transactions > 0 || usage.value.assets > 0) {
          return failure(
            new ConflictError(
              `A instituição tem ${usage.value.transactions} lançamento(s) e ` +
                `${usage.value.assets} ativo(s) ligados a ela e não pode ser excluída`,
            ),
          );
        }

        const removed = await repositories.institutions.remove(id);
        if (removed.isFailure()) return removed;

        return success({ id });
      },
    );
  });
