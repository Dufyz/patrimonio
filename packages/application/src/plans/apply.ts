import { dedupeKey, isPortfolioScoped, transition } from '@patrimonio/domain';
import type {
  DateOnly,
  OutboxEventDraft,
  RecalcStatus,
  Stage,
  StageOutcome,
} from '@patrimonio/domain';
import { success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';
import type { AlertUpsertRow } from '../interfaces/alert.repository.js';
import type {
  PortfolioDailyWrite,
  PositionDailyWrite,
  RealizedResultWrite,
  TaxMonthWrite,
} from '../interfaces/projection.repository.js';
import type { EnqueuedEvent } from '../interfaces/outbox.repository.js';
import type { TransactionalRepositories } from '../interfaces/unit-of-work.js';

/**
 * `apply` executa o plano e não decide nada. A regra de negócio mora no plano; aqui
 * se grava, se aplica a transição de estado e se insere os eventos na outbox — na
 * mesma transação, sempre.
 *
 * As duas garantias que isto existe para dar:
 *
 * 1. **Atomicidade.** O evento da outbox vive na mesma transação do estado que o
 *    origina. Abortar não deixa evento órfão, e uma falha no meio de um recálculo
 *    de dez anos não deixa projeção parcial: ou o intervalo inteiro foi reescrito,
 *    ou nada foi.
 * 2. **Serialização.** A trava por carteira é tomada por quem abre a transação
 *    (`unitOfWork.run({ lock })`), e é ela que impede o fechamento diário e um
 *    lançamento salvo ao mesmo tempo de se sobreporem. Sem ela a corrida aparece
 *    como número errado meses depois, sem rastro.
 *
 * `recalc_status` é escrito aqui e em nenhum outro lugar. Nenhum caso de uso o
 * toca: o plano devolve o desfecho do estágio e `transition()` decide o resto.
 */
export type ProjectionWrite = {
  /** A projeção é apagada a partir daqui antes de ser regravada. */
  readonly delete_from: DateOnly;
  readonly positions: readonly PositionDailyWrite[];
  readonly portfolio_days: readonly PortfolioDailyWrite[];
};

export type RealizedWrite = {
  readonly from_date: DateOnly;
  readonly rows: readonly RealizedResultWrite[];
};

export type AlertWrite = {
  readonly upserts: readonly AlertUpsertRow[];
  readonly resolved: readonly {
    readonly rule_kind: string;
    readonly subject_id: string;
  }[];
};

export type ApplicablePlan = {
  readonly stage: Stage;
  readonly outcome: StageOutcome;
  /** Só em `failed`: 5xx volta para a fila, 4xx para o pipeline. */
  readonly recoverable?: boolean | undefined;
  /** Nulo nos estágios globais, que não têm carteira no escopo. */
  readonly portfolio_id: string | null;
  readonly reference_date: DateOnly;
  /** A data de onde o recálculo partiu, para a carteira registrar o intervalo. */
  readonly from_date?: DateOnly | null | undefined;
  readonly error?: string | null | undefined;
  readonly projection?: ProjectionWrite | undefined;
  readonly realized?: RealizedWrite | undefined;
  readonly tax_months?: readonly TaxMonthWrite[] | undefined;
  readonly alerts?: AlertWrite | undefined;
  /** Eventos que o próprio plano pediu, além do que a transição encadeia. */
  readonly events?: readonly OutboxEventDraft[] | undefined;
  readonly origin_request_id?: string | undefined;
};

export type ApplyReport = {
  readonly stage: Stage;
  readonly recalc_status: RecalcStatus;
  readonly next: Stage | null;
  readonly written: {
    readonly positions: number;
    readonly portfolio_days: number;
    readonly realized: number;
    readonly tax_months: number;
    readonly alerts: number;
    readonly alerts_resolved: number;
  };
  readonly queued: readonly EnqueuedEvent[];
};

/**
 * O evento que a transição encadeia. `import` não aparece aqui porque nenhum
 * estágio o pede: importação nasce de um upload, não de outro estágio.
 */
const nextEvent = (stage: Stage, plan: ApplicablePlan): OutboxEventDraft | null => {
  const origin =
    plan.origin_request_id === undefined
      ? {}
      : { origin_request_id: plan.origin_request_id };

  switch (stage) {
    case 'recalc':
      if (plan.portfolio_id === null) return null;
      return {
        stage: 'recalc',
        dedupe_key: dedupeKey.recalc(plan.portfolio_id),
        payload: {
          portfolio_id: plan.portfolio_id,
          from_date: plan.from_date ?? plan.reference_date,
        },
        ...origin,
      };
    case 'market':
      return {
        stage: 'market',
        dedupe_key: dedupeKey.market(plan.reference_date),
        payload: { reference_date: plan.reference_date },
        ...origin,
      };
    case 'close':
      return {
        stage: 'close',
        dedupe_key: dedupeKey.close(plan.reference_date),
        payload: { reference_date: plan.reference_date },
        ...origin,
      };
    case 'alerts':
      return {
        stage: 'alerts',
        dedupe_key: dedupeKey.alerts(plan.reference_date),
        payload: { reference_date: plan.reference_date },
        ...origin,
      };
    case 'backup':
      return {
        stage: 'backup',
        dedupe_key: dedupeKey.backup(plan.reference_date),
        payload: { reference_date: plan.reference_date },
        ...origin,
      };
    case 'import':
      return null;
  }
};

export const applyPlan = async (
  repositories: TransactionalRepositories,
  plan: ApplicablePlan,
): Promise<Either<AppError, ApplyReport>> => {
  const written = {
    positions: 0,
    portfolio_days: 0,
    realized: 0,
    tax_months: 0,
    alerts: 0,
    alerts_resolved: 0,
  };

  if (plan.projection !== undefined && plan.portfolio_id !== null) {
    // Apagar antes de regravar: reconstruir é refazer do livro, não corrigir no
    // lugar. Como tudo acontece numa transação, não existe o instante em que a
    // carteira aparece sem projeção.
    const removed = await repositories.projections.deleteFrom(
      plan.portfolio_id,
      plan.projection.delete_from,
    );
    if (removed.isFailure()) return removed;

    const positions = await repositories.projections.upsertPositions(
      plan.projection.positions,
    );
    if (positions.isFailure()) return positions;

    const days = await repositories.projections.upsertPortfolioDays(
      plan.projection.portfolio_days,
    );
    if (days.isFailure()) return days;

    written.positions = positions.value;
    written.portfolio_days = days.value;
  }

  if (plan.realized !== undefined && plan.portfolio_id !== null) {
    const realized = await repositories.projections.replaceRealized(
      plan.portfolio_id,
      plan.realized.from_date,
      plan.realized.rows,
    );
    if (realized.isFailure()) return realized;

    written.realized = realized.value;
  }

  if (plan.tax_months !== undefined && plan.tax_months.length > 0) {
    const months = await repositories.projections.upsertTaxMonths(plan.tax_months);
    if (months.isFailure()) return months;

    written.tax_months = months.value;
  }

  if (plan.alerts !== undefined) {
    const alerts = await repositories.alerts.applyReconciliation(
      plan.alerts.upserts,
      plan.alerts.resolved,
    );
    if (alerts.isFailure()) return alerts;

    written.alerts = alerts.value.written;
    written.alerts_resolved = alerts.value.removed;
  }

  const moved = transition({
    stage: plan.stage,
    outcome: plan.outcome,
    ...(plan.recoverable === undefined ? {} : { recoverable: plan.recoverable }),
  });

  if (plan.portfolio_id !== null && isPortfolioScoped(plan.stage)) {
    const applied = await repositories.portfolios.applyRecalcTransition(
      plan.portfolio_id,
      {
        recalc_status: moved.recalc_status,
        from_date: plan.from_date ?? null,
        error: plan.error ?? null,
      },
    );
    if (applied.isFailure()) return applied;
  }

  const chained = moved.next === null ? null : nextEvent(moved.next, plan);

  const events = [...(plan.events ?? []), ...(chained === null ? [] : [chained])];

  const queued = await repositories.outbox.enqueue(events);
  if (queued.isFailure()) return queued;

  return success({
    stage: plan.stage,
    recalc_status: moved.recalc_status,
    next: moved.next,
    written,
    queued: queued.value,
  });
};
