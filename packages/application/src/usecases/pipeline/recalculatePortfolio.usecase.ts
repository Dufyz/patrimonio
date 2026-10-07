import type { DateOnly } from '@patrimonio/domain';
import { either, success } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { applyPlan } from '../../plans/apply.js';
import type { ApplyReport } from '../../plans/apply.js';
import { planRecalculation } from '../../plans/recalculation.plan.js';
import type { RecalculationReport } from '../../plans/recalculation.plan.js';
import { planTaxes } from '../../plans/taxes.plan.js';
import { loadRecalculationContext, loadTaxSales } from './context.js';

/**
 * Reconstruir a projeção de uma carteira a partir de uma data. É a operação que o
 * evento `recalc` da outbox dispara, e a razão de ela existir fora da request:
 * um lançamento de 2015 corrigido hoje reescreve dez anos, e numa request HTTP o
 * timeout cortaria no meio e deixaria metade do histórico reescrito.
 *
 * A trava é por carteira. Ela é o que impede este recálculo e o fechamento diário
 * de se sobreporem — sem ela a corrida aparece como número errado meses depois,
 * sem rastro de onde veio.
 */
export const portfolioLock = (portfolioId: string): string => `portfolio:${portfolioId}`;

export type RecalculateInput = {
  readonly portfolio_id: string;
  readonly from_date: DateOnly;
  /** Até onde reconstruir. O padrão é hoje, pelo relógio injetado. */
  readonly through_date?: DateOnly | undefined;
  readonly origin_request_id?: string | undefined;
};

export type RecalculateResult = {
  readonly report: RecalculationReport | null;
  readonly applied: ApplyReport | null;
};

export type RecalculatePortfolioDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /**
   * Atraso injetado entre a leitura e a escrita, só em teste. É com ele que o
   * teste de concorrência reproduz o cenário em que o usuário salva um lançamento
   * enquanto o fechamento diário roda — o teste que mais paga de toda a suíte.
   */
  readonly betweenLoadAndWrite?: (() => Promise<void>) | undefined;
};

export const recalculatePortfolio = (deps: RecalculatePortfolioDeps) =>
  either(async function* (input: RecalculateInput) {
    const through = input.through_date ?? deps.clock.today();

    return yield* await deps.unitOfWork.run<AppError, RecalculateResult>(
      async (repositories) => {
        // A apuração é global e vem primeiro: ela decide a isenção e a compensação
        // de cada venda, e `realized_result` grava essa decisão junto do resultado.
        const sales = await loadTaxSales(repositories, through);
        if (sales.isFailure()) return sales;

        const taxes = planTaxes({ sales: sales.value });

        const context = await loadRecalculationContext(repositories, {
          portfolio_id: input.portfolio_id,
          from_date: input.from_date,
          through_date: through,
          tax_annotations: taxes.annotations,
        });
        if (context.isFailure()) return context;

        if (deps.betweenLoadAndWrite !== undefined) await deps.betweenLoadAndWrite();

        // Carteira sem lançamento: nada a reconstruir, e o estágio termina bem.
        if (context.value === null) {
          const applied = await applyPlan(repositories, {
            stage: 'recalc',
            outcome: 'succeeded',
            portfolio_id: input.portfolio_id,
            reference_date: through,
            from_date: input.from_date,
            ...(input.origin_request_id === undefined
              ? {}
              : { origin_request_id: input.origin_request_id }),
          });
          if (applied.isFailure()) return applied;

          return success({ report: null, applied: applied.value });
        }

        const plan = planRecalculation(context.value);

        const applied = await applyPlan(repositories, {
          stage: 'recalc',
          outcome: 'succeeded',
          portfolio_id: input.portfolio_id,
          reference_date: through,
          from_date: input.from_date,
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

        return success({ report: plan.report, applied: applied.value });
      },
      { lock: portfolioLock(input.portfolio_id) },
    );
  });
