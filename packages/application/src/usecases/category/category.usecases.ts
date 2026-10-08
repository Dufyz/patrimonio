import type { Category } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError, ConflictError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type {
  CategoryDraft,
  CategoryRepository,
  CategoryWrite,
} from '../../interfaces/category.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

export type CategoryDeps = { readonly categories: CategoryRepository };
export type CategoryWriteDeps = { readonly unitOfWork: UnitOfWork };

export const listCategories = (deps: CategoryDeps) =>
  either(async function* () {
    return yield* await deps.categories.list();
  });

/**
 * O pai precisa ser grupo. O trigger do banco recusa o terceiro nível de todo
 * jeito; a conferência aqui existe para a mensagem dizer o que está errado em
 * vez de devolver uma violação de restrição.
 */
export const createCategory = (deps: CategoryWriteDeps) =>
  either(async function* (draft: CategoryDraft) {
    return yield* await deps.unitOfWork.run<AppError, Category>(async (repositories) => {
      if (draft.parent_id !== undefined && draft.parent_id !== null) {
        const parent = await repositories.categories.findById(draft.parent_id);
        if (parent.isFailure()) return parent;
        if (parent.value === null) {
          return failure(new BadRequestError('A categoria pai não existe'));
        }
        if (parent.value.parent_id !== null) {
          return failure(
            new BadRequestError(
              `A categoria aceita dois níveis: ${parent.value.name} já está dentro de um grupo`,
            ),
          );
        }
      }

      return repositories.categories.create(draft);
    });
  });

export const updateCategory = (deps: CategoryWriteDeps) =>
  either(async function* (id: string, patch: CategoryWrite) {
    return yield* await deps.unitOfWork.run<AppError, Category>(async (repositories) => {
      if (patch.parent_id !== undefined && patch.parent_id !== null) {
        if (patch.parent_id === id) {
          return failure(
            new BadRequestError('Uma categoria não pode ser pai de si mesma'),
          );
        }

        const parent = await repositories.categories.findById(patch.parent_id);
        if (parent.isFailure()) return parent;
        if (parent.value === null) {
          return failure(new BadRequestError('A categoria pai não existe'));
        }
        if (parent.value.parent_id !== null) {
          return failure(
            new BadRequestError(
              `A categoria aceita dois níveis: ${parent.value.name} já está dentro de um grupo`,
            ),
          );
        }

        // Virar categoria filha quando se tem filhas criaria o terceiro nível
        // por tabela, sem nenhuma linha quebrar sozinha.
        const usage = await repositories.categories.usage(id);
        if (usage.isFailure()) return usage;
        if (usage.value.children > 0) {
          return failure(
            new BadRequestError(
              'Este grupo tem categorias dentro dele e não pode virar categoria',
            ),
          );
        }
      }

      const updated = await repositories.categories.update(id, patch);
      if (updated.isFailure()) return updated;
      if (updated.value === null) {
        return failure(new NotFoundError(`Categoria ${id} não encontrada`));
      }

      return success(updated.value);
    });
  });

/**
 * Categoria renomeada mantém os lançamentos ligados — o vínculo é por id. O que
 * não acontece é sumir com uma categoria que ainda classifica ativo ou alvo:
 * isso deixaria a alocação sem referência, e o número na tela sem explicação.
 */
export const deleteCategory = (deps: CategoryWriteDeps) =>
  either(async function* (id: string) {
    return yield* await deps.unitOfWork.run<AppError, { readonly id: string }>(
      async (repositories) => {
        const found = await repositories.categories.findById(id);
        if (found.isFailure()) return found;
        if (found.value === null) {
          return failure(new NotFoundError(`Categoria ${id} não encontrada`));
        }

        const usage = await repositories.categories.usage(id);
        if (usage.isFailure()) return usage;

        if (
          usage.value.assets > 0 ||
          usage.value.targets > 0 ||
          usage.value.children > 0
        ) {
          return failure(
            new ConflictError(
              `A categoria classifica ${usage.value.assets} ativo(s), aparece em ` +
                `${usage.value.targets} alvo(s) e tem ${usage.value.children} ` +
                'categoria(s) dentro dela, e por isso não pode ser excluída',
            ),
          );
        }

        const removed = await repositories.categories.remove(id);
        if (removed.isFailure()) return removed;

        return success({ id });
      },
    );
  });
