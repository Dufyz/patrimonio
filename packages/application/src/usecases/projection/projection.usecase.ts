import { PROJECTION_HORIZONS, projectPortfolio, projectTotal } from '@patrimonio/calc';
import type { ProjectionResult } from '@patrimonio/calc';
import { either, failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { InvalidParameterError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import { FinanceError } from '../../errors/finance-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type {
  ProjectionPlanRepository,
  ProjectionPlanRow,
  ProjectionPlanWrite,
} from '../../interfaces/projection_plan.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

export type GetProjectionDeps = {
  readonly projectionPlans: ProjectionPlanRepository;
  readonly clock: Clock;
};

export type GetProjectionInput = {
  /** Ausente é Todas as carteiras. */
  readonly portfolio_id?: string | undefined;
  readonly horizon_months?: number | undefined;
};

export type ProjectionPortfolio = ProjectionPlanRow & {
  /** Sem rentabilidade esperada a projeção usa 0,00%, e a tela avisa. */
  readonly return_assumed_zero: boolean;
  /** Nulo quando a carteira não foi consolidada: não há de onde partir. */
  readonly projection: ProjectionResult | null;
};

export type ProjectionResource = {
  readonly horizon_months: number;
  readonly as_of: string;
  readonly portfolios: readonly ProjectionPortfolio[];
  /** Soma das carteiras projetadas; nulo se nenhuma pôde ser projetada. */
  readonly total: ProjectionResult | null;
};

export const DEFAULT_HORIZON = 24;

export const getProjection = (deps: GetProjectionDeps) =>
  either(async function* (input: GetProjectionInput) {
    const horizon = input.horizon_months ?? DEFAULT_HORIZON;
    if (!(PROJECTION_HORIZONS as readonly number[]).includes(horizon)) {
      return yield* failure(
        new InvalidParameterError('Horizonte deve ser 12, 24, 36 ou 60 meses'),
      );
    }

    const today = deps.clock.today();
    const rows = yield* await deps.projectionPlans.list(today);
    const scoped =
      input.portfolio_id === undefined
        ? rows
        : rows.filter((row) => row.portfolio_id === input.portfolio_id);

    if (input.portfolio_id !== undefined && scoped.length === 0) {
      return yield* failure(
        new NotFoundError(`Carteira ${input.portfolio_id} não encontrada`),
      );
    }

    const portfolios: ProjectionPortfolio[] = scoped.map((row) => ({
      ...row,
      return_assumed_zero: row.expected_return_pct === null,
      projection:
        row.current_value === null
          ? null
          : projectPortfolio({
              today,
              current_value: row.current_value,
              annual_return_pct: row.expected_return_pct ?? '0',
              rules: row.rules,
              horizon_months: horizon,
            }),
    }));

    const projected = portfolios.flatMap((item) =>
      item.projection === null ? [] : [item.projection],
    );

    const resource: ProjectionResource = {
      horizon_months: horizon,
      as_of: today,
      portfolios,
      total: projected.length === 0 ? null : projectTotal(projected),
    };

    return resource;
  });

export type PutProjectionPlanDeps = { readonly unitOfWork: UnitOfWork };

export const validatePlan = (
  write: ProjectionPlanWrite,
): Either<InvalidParameterError, void> => {
  if (write.expected_return_pct !== null) {
    const pct = Number(write.expected_return_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return failure(
        new InvalidParameterError('A rentabilidade esperada vai de 0 a 100%'),
      );
    }
  }

  for (const rule of write.rules) {
    if (!(Number(rule.amount) > 0)) {
      return failure(new InvalidParameterError('O valor da regra precisa ser positivo'));
    }
    if (rule.until !== null && rule.until < rule.from) {
      return failure(new InvalidParameterError('O fim da regra vem depois do início'));
    }
  }

  return success(undefined);
};

/** Troca a rentabilidade esperada e as regras de aporte da carteira. */
export const putProjectionPlan = (deps: PutProjectionPlanDeps) =>
  either(async function* (
    portfolioId: string,
    write: ProjectionPlanWrite,
    ifMatch?: string | undefined,
  ) {
    yield* validatePlan(write);

    return yield* await deps.unitOfWork.run<AppError, void>(async (repositories) => {
      const found = await repositories.portfolios.findById(portfolioId);
      if (found.isFailure()) return found;
      if (found.value === null || found.value.archived_at !== null) {
        return failure(new NotFoundError(`Carteira ${portfolioId} não encontrada`));
      }

      if (
        ifMatch !== undefined &&
        new Date(ifMatch).getTime() !== new Date(found.value.updated_at).getTime()
      ) {
        return failure(
          new FinanceError(
            [
              {
                code: 'VERSAO_DIVERGENTE',
                message: 'O plano mudou desde que você o abriu.',
                details: { current: found.value.updated_at },
              },
            ],
            409,
          ),
        );
      }

      return repositories.projectionPlans.save(portfolioId, write);
    });
  });
