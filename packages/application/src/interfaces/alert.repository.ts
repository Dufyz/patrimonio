import type { AlertInstance, AlertStatus, DateOnly } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * O alerta é a única projeção com estado que o usuário mexe: adiar e ignorar. Esse
 * estado precisa sobreviver ao recálculo, e é por isso que a escrita é
 * reconciliação por `(rule_kind, subject_id)` em vez de apagar e regravar — um
 * `DELETE` seguido de `INSERT` perderia a decisão e o alerta voltaria à frente do
 * usuário, que é como se aprende a ignorar o painel.
 */
export type AlertRule = {
  readonly kind: string;
  readonly enabled: boolean;
  readonly threshold: Record<string, unknown> | null;
  readonly scope: 'global' | 'per_portfolio';
};

/** O que uma regra produziu numa execução. */
export type AlertFinding = {
  readonly rule_kind: string;
  /** O que o alerta aponta: ativo, carteira, objetivo ou conta. */
  readonly subject_id: string;
  readonly portfolio_id: string | null;
  /** Os valores que o texto do alerta mostra. */
  readonly payload: Record<string, unknown>;
};

/** A linha que a reconciliação grava, já decidida pelo plano. */
export type AlertUpsertRow = {
  readonly rule_kind: string;
  readonly subject_id: string;
  readonly portfolio_id: string | null;
  readonly payload: Record<string, unknown>;
  readonly status: AlertStatus;
  readonly snooze_until: DateOnly | null;
};

export type AlertRepository = {
  readonly listRules: () => Promise<Either<AppError, AlertRule[]>>;

  readonly setRuleEnabled: (
    kind: string,
    enabled: boolean,
  ) => Promise<Either<AppError, AlertRule | null>>;

  readonly setRuleThreshold: (
    kind: string,
    threshold: Record<string, unknown> | null,
  ) => Promise<Either<AppError, AlertRule | null>>;

  /**
   * As instâncias que já existem para as regras executadas neste escopo. É a
   * leitura de que a reconciliação precisa: quem decide o que fazer com elas é
   * `reconcileAlerts`, em `plans/alerts.plan.ts`, e não uma consulta.
   */
  readonly listForRules: (
    scope: {
      readonly rule_kinds: readonly string[];
      readonly portfolio_id?: string | null | undefined;
    },
  ) => Promise<Either<AppError, AlertInstance[]>>;

  /**
   * Aplica a reconciliação em duas consultas: um `UPSERT` do que vale e um
   * `DELETE` do que saiu. O `status` gravado é o que o plano mandou, e o plano
   * manda o que já estava lá — é assim que adiado e ignorado sobrevivem ao
   * recálculo.
   */
  readonly applyReconciliation: (
    upserts: readonly AlertUpsertRow[],
    resolved: readonly { readonly rule_kind: string; readonly subject_id: string }[],
  ) => Promise<
    Either<AppError, { readonly written: number; readonly removed: number }>
  >;

  /** O que o painel Requer atenção lê: aberto, e adiado cuja data já passou. */
  readonly listActive: (
    options: {
      readonly portfolio_id?: string | null | undefined;
      readonly on_date: DateOnly;
    },
  ) => Promise<Either<AppError, AlertInstance[]>>;

  readonly listByStatus: (
    status: AlertStatus,
  ) => Promise<Either<AppError, AlertInstance[]>>;

  /** Adiar esconde até a data escolhida; ignorar vale só para aquele item. */
  readonly setStatus: (
    key: { readonly rule_kind: string; readonly subject_id: string },
    status: AlertStatus,
    snoozeUntil: DateOnly | null,
  ) => Promise<Either<AppError, AlertInstance | null>>;
};
