import { fgcHeadroom } from '@patrimonio/calc';
import { FGC_LIMIT_BRL } from '@patrimonio/domain';
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

export type FgcExposure = {
  readonly institution_id: string;
  readonly institution_name: string;
  readonly fgc_covered: boolean;
  readonly limit_brl: string;
  readonly exposure_brl: string;
  readonly available_brl: string;
  readonly over_limit: boolean;
  readonly basis: 'cost';
};

/**
 * Quanto do teto do FGC já está usado neste emissor. A base é o custo enquanto
 * a marcação na curva não existe (E3), e o campo `basis` diz isso em vez de
 * deixar a tela apresentar um número como se fosse valor de mercado.
 */
export const getFgcExposure = (deps: InstitutionDeps) =>
  either(async function* (id: string) {
    const institution = yield* await deps.institutions.findById(id);

    if (institution === null) {
      return yield* failure(new NotFoundError(`Instituição ${id} não encontrada`));
    }

    const exposure = yield* await deps.institutions.issuerExposure(id);

    const headroom = fgcHeadroom(exposure.exposure_brl, FGC_LIMIT_BRL);

    const result: FgcExposure = {
      institution_id: institution.id,
      institution_name: institution.name,
      fgc_covered: institution.fgc_covered,
      limit_brl: headroom.limit_brl,
      exposure_brl: headroom.exposure_brl,
      available_brl: headroom.available_brl,
      over_limit: headroom.over_limit,
      basis: 'cost',
    };

    return result;
  });
