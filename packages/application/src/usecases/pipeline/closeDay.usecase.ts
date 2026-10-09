import type { DateOnly } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { applyPlan } from '../../plans/apply.js';
import { planRecalculation } from '../../plans/recalculation.plan.js';
import { planTaxes } from '../../plans/taxes.plan.js';
import { loadRecalculationContext, loadTaxSales } from './context.js';
import { portfolioLock } from './recalculatePortfolio.usecase.js';

/**
 * O fechamento do dia é o recálculo de um dia só, para todas as carteiras. Ele não
 * é um caminho separado de propósito: se o fechamento usasse um cálculo próprio,
 * a projeção do dia a dia poderia divergir da reconstruída, e a invariante central
 * do modelo — reconstruir do zero é igual ao incremental — deixaria de valer.
 *
 * Cada carteira fecha na sua própria transação, com a sua trava. Travar todas de
 * uma vez serializaria o fechamento com qualquer lançamento sendo salvo em
 * qualquer carteira, e o fechamento de dez carteiras travaria o app inteiro.
 *
 * A consequência é que uma carteira fecha por inteiro ou não fecha: não existe
 * projeção parcial **dentro** de uma carteira. Se a terceira falhar, as duas
 * primeiras ficam fechadas e o estágio falha; o job reexecuta, e reexecutar o
 * mesmo dia produz exatamente as mesmas linhas, porque a escrita é `UPSERT` sobre
 * `(portfolio_id, position_date)` e o cálculo é função do livro, não do momento.
 */
export type CloseDayInput = {
  readonly reference_date?: DateOnly | undefined;
  readonly origin_request_id?: string | undefined;
};

export type ClosedPortfolio = {
  readonly portfolio_id: string;
  readonly positions: number;
  readonly total_value: string;
  readonly stale: boolean;
};

export type CloseDayResult = {
  readonly reference_date: DateOnly;
  readonly portfolios: readonly ClosedPortfolio[];
  /** Verdadeiro quando o dia não é útil: não houve pregão, e nada foi gravado. */
  readonly skipped: boolean;
};

export type CloseDayDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
};

export const closeDay = (deps: CloseDayDeps) =>
  either(async function* (input: CloseDayInput) {
    const date = input.reference_date ?? deps.clock.today();

    // Dia sem negociação na B3 não gera fechamento. Gerar uma linha repetida no
    // feriado inventaria um dia de série que não existiu.
    const scope = yield* await deps.unitOfWork.run<
      AppError,
      { readonly business: boolean; readonly portfolios: readonly string[] }
    >(async (repositories) => {
      const business = await repositories.businessDays.isBusinessDay(date);
      if (business.isFailure()) return business;

      const portfolios = await repositories.portfolios.listActiveIds();
      if (portfolios.isFailure()) return portfolios;

      return success({ business: business.value, portfolios: portfolios.value });
    });

    if (!scope.business) {
      const nothing: CloseDayResult = {
        reference_date: date,
        portfolios: [],
        skipped: true,
      };

      return nothing;
    }

    const closed: ClosedPortfolio[] = [];

    for (const portfolioId of scope.portfolios) {
      const result = yield* await deps.unitOfWork.run<AppError, ClosedPortfolio | null>(
        async (repositories) => {
          const sales = await loadTaxSales(repositories, date);
          if (sales.isFailure()) return sales;

          const taxes = planTaxes({ sales: sales.value });

          const context = await loadRecalculationContext(repositories, {
            portfolio_id: portfolioId,
            from_date: date,
            through_date: date,
            tax_annotations: taxes.annotations,
          });
          if (context.isFailure()) return context;
          if (context.value === null) return success(null);

          const plan = planRecalculation(context.value);

          const applied = await applyPlan(repositories, {
            stage: 'close',
            outcome: 'succeeded',
            portfolio_id: portfolioId,
            reference_date: date,
            from_date: date,
            projection: {
              delete_from: plan.delete_from,
              positions: plan.positions,
              portfolio_days: plan.portfolio_days,
            },
            realized: { from_date: plan.delete_from, rows: plan.realized },
            tax_months: taxes.months,
            ...(input.origin_request_id === undefined
              ? {}
              : { origin_request_id: input.origin_request_id }),
          });
          if (applied.isFailure()) return applied;

          const day = plan.portfolio_days[0];
          if (day === undefined) {
            return failure(
              new BadRequestError('O fechamento não produziu linha nenhuma'),
            );
          }

          return success({
            portfolio_id: portfolioId,
            positions: plan.positions.length,
            total_value: day.total_value,
            stale: plan.report.days_with_stale_price > 0,
          });
        },
        { lock: portfolioLock(portfolioId) },
      );

      if (result !== null) closed.push(result);
    }

    const result: CloseDayResult = {
      reference_date: date,
      portfolios: closed,
      skipped: false,
    };

    return result;
  });
