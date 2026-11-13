import type { DateOnly } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * PRJ-06 · O plano que a Projeção lê: por carteira ativa, o valor de hoje, a
 * rentabilidade anual esperada e as regras de aporte. Nada de Finanças entra.
 */
export type ProjectionRuleRow = {
  readonly amount: string;
  /** `YYYY-MM`. */
  readonly from: string;
  readonly until: string | null;
};

export type ProjectionPlanRow = {
  readonly portfolio_id: string;
  readonly name: string;
  /** Nulo quando a carteira não tem rentabilidade esperada. */
  readonly expected_return_pct: string | null;
  /** Último fechamento até hoje; nulo se a carteira ainda não foi consolidada. */
  readonly current_value: string | null;
  readonly as_of: DateOnly | null;
  readonly rules: readonly ProjectionRuleRow[];
};

export type ProjectionPlanWrite = {
  readonly expected_return_pct: string | null;
  readonly rules: readonly ProjectionRuleRow[];
};

export type ProjectionPlanRepository = {
  readonly list: (
    today: DateOnly,
  ) => Promise<Either<AppError, readonly ProjectionPlanRow[]>>;
  /** Troca a rentabilidade e todas as regras da carteira, numa transação só. */
  readonly save: (
    portfolioId: string,
    write: ProjectionPlanWrite,
  ) => Promise<Either<AppError, void>>;
};
