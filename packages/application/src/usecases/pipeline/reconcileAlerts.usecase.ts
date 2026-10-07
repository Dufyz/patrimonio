import type { DateOnly } from '@patrimonio/domain';
import { either, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { AlertFinding, AlertRule } from '../../interfaces/alert.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { applyPlan } from '../../plans/apply.js';
import { reconcileAlerts as planReconciliation } from '../../plans/alerts.plan.js';
import type { AlertsPlan } from '../../plans/alerts.plan.js';

/**
 * As regras rodam no fechamento do dia e **gravam** o resultado; a tela de Requer
 * atenção só lê. Rodar as regras na abertura da tela deixaria o painel lento e,
 * pior, faria o alerta aparecer e desaparecer conforme a hora em que a tela foi
 * aberta.
 *
 * O que este caso de uso garante é a parte difícil: o estado que o usuário mexeu
 * sobrevive. Adiado continua adiado, ignorado não volta, e nada disso depende de o
 * recálculo ser gentil — depende de a reconciliação ser por
 * `(rule_kind, subject_id)` em vez de apagar e regravar.
 *
 * As treze regras entram em E7. O motor que as executa já está aqui, e uma regra
 * desligada não gera alerta nem consome processamento.
 */
export type AlertRuleRunner = (
  repositories: TransactionalRepositories,
  input: { readonly rule: AlertRule; readonly reference_date: DateOnly },
) => Promise<Either<AppError, readonly AlertFinding[]>>;

export type ReconcileAlertsInput = {
  readonly reference_date?: DateOnly | undefined;
  /** Nulo reconcilia o escopo global; com carteira, só os alertas dela. */
  readonly portfolio_id?: string | null | undefined;
  readonly origin_request_id?: string | undefined;
};

export type ReconcileAlertsResult = {
  readonly reference_date: DateOnly;
  readonly rules_run: readonly string[];
  readonly report: AlertsPlan['report'];
};

export type ReconcileAlertsDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /**
   * As regras ligadas, uma por `kind`. Regra sem executor declarado não produz
   * achado e não é reconciliada — é o que permite ligar as treze de E7 uma a uma
   * sem que as ainda não escritas apaguem o que já existe.
   */
  readonly runners?: Readonly<Record<string, AlertRuleRunner>> | undefined;
};

export const reconcileAlerts = (deps: ReconcileAlertsDeps) =>
  either(async function* (input: ReconcileAlertsInput) {
    const date = input.reference_date ?? deps.clock.today();
    const runners = deps.runners ?? {};

    return yield* await deps.unitOfWork.run<AppError, ReconcileAlertsResult>(
      async (repositories) => {
        const rules = await repositories.alerts.listRules();
        if (rules.isFailure()) return rules;

        // Regra desligada não gera alerta nem consome processamento: ela sai da
        // lista antes de qualquer leitura.
        const active = rules.value.filter(
          (rule) => rule.enabled && runners[rule.kind] !== undefined,
        );

        const findings: AlertFinding[] = [];

        for (const rule of active) {
          const runner = runners[rule.kind];
          if (runner === undefined) continue;

          const found = await runner(repositories, { rule, reference_date: date });
          if (found.isFailure()) return found;

          findings.push(...found.value);
        }

        const kinds = active.map((rule) => rule.kind);

        const existing = await repositories.alerts.listForRules({
          rule_kinds: kinds,
          portfolio_id: input.portfolio_id ?? null,
        });
        if (existing.isFailure()) return existing;

        const plan = planReconciliation({
          existing: existing.value,
          findings,
        });

        const applied = await applyPlan(repositories, {
          stage: 'alerts',
          outcome: 'succeeded',
          portfolio_id: input.portfolio_id ?? null,
          reference_date: date,
          alerts: { upserts: plan.upserts, resolved: plan.resolved },
          ...(input.origin_request_id === undefined
            ? {}
            : { origin_request_id: input.origin_request_id }),
        });
        if (applied.isFailure()) return applied;

        return success({ reference_date: date, rules_run: kinds, report: plan.report });
      },
    );
  });
