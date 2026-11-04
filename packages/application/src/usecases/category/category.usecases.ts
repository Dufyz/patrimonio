import { overlappingGroups } from '@patrimonio/calc';
import type { Category } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import {
  ConflictError,
  InvalidParameterError,
  NotFoundError,
} from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type {
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

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const TWO_LEVELS =
  'A categoria aceita dois níveis: classe e categoria dentro dela. ' +
  'Uma categoria não pode ter outra dentro de si.';

/**
 * A classe nova nasce na raiz, e a categoria dentro de uma classe tem como pai
 * uma raiz: o terceiro nível é recusado com a razão dita, antes de o banco
 * responder com uma violação de restrição.
 */
const checkParent = async (
  categories: CategoryRepository,
  id: string | null,
  parentId: string | null | undefined,
) => {
  if (parentId === null || parentId === undefined) return success(undefined);

  if (parentId === id) {
    return failure(
      new InvalidParameterError('Uma classe não pode estar dentro dela mesma'),
    );
  }

  const parent = await categories.findById(parentId);
  if (parent.isFailure()) return parent;
  if (parent.value === null) {
    return failure(new NotFoundError(`Classe ${parentId} não encontrada`));
  }
  if (parent.value.parent_id !== null)
    return failure(new InvalidParameterError(TWO_LEVELS));

  return success(undefined);
};

export const createCategory = (deps: CategoryWriteDeps) =>
  either(async function* (input: CategoryWrite & { name: string; color_token: string }) {
    return yield* await deps.unitOfWork.run<AppError, Category>(async (repositories) => {
      const parent = await checkParent(repositories.categories, null, input.parent_id);
      if (parent.isFailure()) return parent;

      return repositories.categories.create(input);
    });
  });

/**
 * Mover uma categoria de classe é mudar o `parent_id`, e o id fica: ativo e alvo
 * seguem apontando para ela. Uma coisa precisa ser conferida antes — se a classe
 * de destino tem alvo próprio em alguma carteira, uma categoria que tem alvo
 * próprio ali contaria o mesmo patrimônio duas vezes.
 */
export const updateCategory = (deps: CategoryWriteDeps) =>
  either(async function* (id: string, patch: CategoryWrite) {
    return yield* await deps.unitOfWork.run<AppError, Category>(async (repositories) => {
      const { categories } = repositories;

      const current = await categories.findById(id);
      if (current.isFailure()) return current;
      if (current.value === null) {
        return failure(new NotFoundError(`Categoria ${id} não encontrada`));
      }

      const moving =
        patch.parent_id !== undefined && patch.parent_id !== current.value.parent_id;

      if (moving) {
        const parent = await checkParent(categories, id, patch.parent_id);
        if (parent.isFailure()) return parent;

        // Quem tem categoria dentro é classe: tornar uma classe categoria faria
        // três níveis.
        if (patch.parent_id !== null) {
          const usage = await categories.usage(id);
          if (usage.isFailure()) return usage;
          if (usage.value.children > 0) {
            return failure(
              new InvalidParameterError(
                `${current.value.name} tem ${plural(usage.value.children, 'categoria', 'categorias')} dentro: ` +
                  'esvazie a classe antes de colocá-la dentro de outra',
              ),
            );
          }
        }

        const all = await categories.list();
        if (all.isFailure()) return all;
        const targets = await categories.listTargets();
        if (targets.isFailure()) return targets;

        const after = all.value.map((category) =>
          category.id === id
            ? { ...category, parent_id: patch.parent_id ?? null }
            : category,
        );

        for (const portfolioId of new Set(targets.value.map((row) => row.portfolio_id))) {
          const own = targets.value.filter((row) => row.portfolio_id === portfolioId);
          const overlapped = overlappingGroups(
            own.map((row) => ({ category_id: row.category_id, target_pct: '1' })),
            after,
          );
          if (overlapped.length === 0) continue;

          const group = after.find((category) => category.id === overlapped[0])?.name;
          return failure(
            new ConflictError(
              `A estratégia de ${own[0]?.portfolio_name ?? 'uma carteira'} dá alvo a ` +
                `${group ?? 'a classe'} e a ${current.value.name}: ` +
                'tire o alvo de um dos dois antes de mover',
            ),
          );
        }
      }

      const updated = await categories.update(id, patch);
      if (updated.isFailure()) return updated;
      if (updated.value === null) {
        return failure(new NotFoundError(`Categoria ${id} não encontrada`));
      }

      return success(updated.value);
    });
  });

export const deleteCategory = (deps: CategoryWriteDeps) =>
  either(async function* (id: string) {
    return yield* await deps.unitOfWork.run<AppError, { readonly id: string }>(
      async (repositories) => {
        const { categories } = repositories;

        const current = await categories.findById(id);
        if (current.isFailure()) return current;
        if (current.value === null) {
          return failure(new NotFoundError(`Categoria ${id} não encontrada`));
        }

        const usage = await categories.usage(id);
        if (usage.isFailure()) return usage;

        const reasons = [
          usage.value.children > 0
            ? `${plural(usage.value.children, 'categoria', 'categorias')} dentro`
            : null,
          usage.value.assets > 0 ? plural(usage.value.assets, 'ativo', 'ativos') : null,
          usage.value.targets > 0
            ? `alvo em ${plural(usage.value.targets, 'carteira', 'carteiras')}`
            : null,
        ].filter((reason): reason is string => reason !== null);

        if (reasons.length > 0) {
          return failure(
            new ConflictError(
              `${current.value.name} não pode ser excluída: tem ${reasons.join(', ')}`,
            ),
          );
        }

        const removed = await categories.delete(id);
        if (removed.isFailure()) return removed;

        return success({ id });
      },
    );
  });
