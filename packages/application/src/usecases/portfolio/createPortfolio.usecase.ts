import { duplicatedCategories, sumTargets } from '@patrimonio/calc';
import type { Portfolio } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { InvalidParameterError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import { ConflictError } from '../../errors/app-error.js';
import type {
  PortfolioDraft,
  StrategyTargetWrite,
} from '../../interfaces/portfolio.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

export type CreatePortfolioInput = PortfolioDraft & {
  readonly allocation_targets?: readonly StrategyTargetWrite[] | undefined;
};

export type CreatePortfolioDeps = { readonly unitOfWork: UnitOfWork };

/**
 * A mesma regra do alvo responde o mesmo nos três lugares que a usam — criar,
 * editar e `PUT /strategy` — em vez de três mensagens diferentes para o mesmo
 * erro. A mensagem aponta a diferença, porque "faltam 4 pp" é acionável e
 * "restrição violada" não é.
 */
export const validateTargets = (
  targets: readonly StrategyTargetWrite[],
): Either<InvalidParameterError, void> => {
  const duplicated = duplicatedCategories(targets);

  if (duplicated.length > 0) {
    return failure(
      new InvalidParameterError(
        `A mesma categoria aparece duas vezes no alvo: ${duplicated.join(', ')}`,
      ),
    );
  }

  const sum = sumTargets(targets);

  if (!sum.closes) {
    return failure(
      new InvalidParameterError(
        `O alvo soma ${sum.total_pct}% e precisa somar 100%: faltam ${sum.missing_pp} pp`,
      ),
    );
  }

  return success(undefined);
};

/**
 * Criar a carteira e gravar o alvo é uma decisão só: uma carteira com alvo pela
 * metade mostraria desvio contra um alvo que o usuário não terminou de
 * declarar. As duas escritas vivem na mesma transação.
 */
export const createPortfolio = (deps: CreatePortfolioDeps) =>
  either(async function* (input: CreatePortfolioInput) {
    const targets = input.allocation_targets ?? [];
    yield* validateTargets(targets);

    const draft: PortfolioDraft = {
      name: input.name,
      benchmark_id: input.benchmark_id,
      sort_order: input.sort_order,
    };

    return yield* await deps.unitOfWork.run<AppError, Portfolio>(async (repositories) => {
      const existing = await repositories.portfolios.findByName(draft.name);
      if (existing.isFailure()) return existing;

      // O índice único é parcial — arquivar libera o nome —, então a
      // conferência aqui é sobre as ativas, que é o que a barra lateral mostra.
      if (existing.value !== null && existing.value.archived_at === null) {
        return failure(new ConflictError(`Já existe uma carteira chamada ${draft.name}`));
      }

      const created = await repositories.portfolios.create(draft);
      if (created.isFailure()) return created;

      if (targets.length > 0) {
        const saved = await repositories.portfolios.replaceTargets(
          created.value.id,
          targets,
        );
        if (saved.isFailure()) return saved;
      }

      return success(created.value);
    });
  });
