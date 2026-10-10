import type { AlertRepository, AlertUpsertRow } from '@patrimonio/application';
import { parseAlertInstanceFromDB } from '@patrimonio/domain';
import type { AlertStatus, DateOnly, Row } from '@patrimonio/domain';
import { asBoolean, asEnum, asJsonOrNull, asString } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

/**
 * A reconciliação é duas consultas: um `UPSERT` do que vale e um `DELETE` do que
 * saiu. O `status` gravado é o que o plano mandou, e o plano manda o que já estava
 * lá — é assim que adiado e ignorado sobrevivem ao recálculo.
 *
 * `first_seen_at` nunca é reescrito: o alerta que aparece todo dia desde março
 * continua dizendo que apareceu em março, e é essa data que diz se o usuário está
 * convivendo com um problema ou acabou de topar com ele.
 */
const parseRule = (
  row: Row,
): {
  readonly kind: string;
  readonly enabled: boolean;
  readonly threshold: Record<string, unknown> | null;
  readonly scope: 'global' | 'per_portfolio';
} => ({
  kind: asString(row, 'kind'),
  enabled: asBoolean(row, 'enabled'),
  threshold: asJsonOrNull(row, 'threshold'),
  scope: asEnum(row, 'scope', ['global', 'per_portfolio'] as const),
});

export const createAlertRepository = (sql: Connection): AlertRepository => ({
  listRules: async () => {
    try {
      const rows = await sql<Row[]>`SELECT * FROM alert_rule ORDER BY kind`;

      return success(rows.map((row) => parseRule(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  setRuleEnabled: async (kind: string, enabled: boolean) => {
    try {
      const rows = await sql<Row[]>`
        UPDATE alert_rule SET enabled = ${enabled} WHERE kind = ${kind} RETURNING *
      `;

      const row = rows[0];

      return success(row === undefined ? null : parseRule(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  setRuleThreshold: async (kind: string, threshold: Record<string, unknown> | null) => {
    try {
      const rows = await sql<Row[]>`
        UPDATE alert_rule
           SET threshold = ${threshold === null ? null : JSON.stringify(threshold)}::JSONB
         WHERE kind = ${kind}
        RETURNING *
      `;

      const row = rows[0];

      return success(row === undefined ? null : parseRule(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listForRules: async (scope) => {
    if (scope.rule_kinds.length === 0) return success([]);

    const portfolioId = scope.portfolio_id ?? null;

    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM alert_instance
         WHERE rule_kind = ANY(${sql.array([...scope.rule_kinds])}::TEXT[])
           AND (${portfolioId}::UUID IS NULL OR portfolio_id = ${portfolioId})
         ORDER BY rule_kind, subject_id
      `;

      return success(rows.map((row) => parseAlertInstanceFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  applyReconciliation: async (
    upserts: readonly AlertUpsertRow[],
    resolved: readonly { readonly rule_kind: string; readonly subject_id: string }[],
  ) => {
    try {
      const written =
        upserts.length === 0
          ? []
          : await sql<{ rule_kind: string }[]>`
              INSERT INTO alert_instance
                (rule_kind, subject_id, portfolio_id, status, snooze_until, payload)
              SELECT entry ->> 'rule_kind',
                     entry ->> 'subject_id',
                     (entry ->> 'portfolio_id')::UUID,
                     (entry ->> 'status')::alert_status,
                     (entry ->> 'snooze_until')::DATE,
                     entry -> 'payload'
                FROM JSONB_ARRAY_ELEMENTS(${JSON.stringify(upserts)}::TEXT::JSONB) AS entry
              ON CONFLICT (rule_kind, subject_id) DO UPDATE SET
                portfolio_id = EXCLUDED.portfolio_id,
                -- O payload é do motor; o status é do usuário, e o plano devolve o
                -- que já estava gravado. Reconciliar não desfaz decisão.
                payload = EXCLUDED.payload,
                status = EXCLUDED.status,
                snooze_until = EXCLUDED.snooze_until
              RETURNING rule_kind
            `;

      const removed =
        resolved.length === 0
          ? []
          : await sql<{ rule_kind: string }[]>`
              DELETE FROM alert_instance
               USING JSONB_ARRAY_ELEMENTS(${JSON.stringify(resolved)}::TEXT::JSONB) AS entry
               WHERE alert_instance.rule_kind = entry ->> 'rule_kind'
                 AND alert_instance.subject_id = entry ->> 'subject_id'
              RETURNING alert_instance.rule_kind
            `;

      return success({ written: written.length, removed: removed.length });
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /**
   * O que o painel mostra: aberto, mais adiado cuja data já chegou. Ignorado fica
   * fora — foi uma decisão sobre aquele item, e a regra continua valendo para os
   * outros.
   */
  listActive: async (options) => {
    const portfolioId = options.portfolio_id ?? null;

    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM alert_instance
         WHERE (status = 'open'
                OR (status = 'snoozed' AND snooze_until <= ${options.on_date}))
           AND (${portfolioId}::UUID IS NULL OR portfolio_id = ${portfolioId})
         ORDER BY first_seen_at
      `;

      return success(rows.map((row) => parseAlertInstanceFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  listByStatus: async (status: AlertStatus) => {
    try {
      const rows = await sql<Row[]>`
        SELECT * FROM alert_instance WHERE status = ${status} ORDER BY updated_at DESC
      `;

      return success(rows.map((row) => parseAlertInstanceFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  setStatus: async (
    key: { readonly rule_kind: string; readonly subject_id: string },
    status: AlertStatus,
    snoozeUntil: DateOnly | null,
  ) => {
    try {
      const rows = await sql<Row[]>`
        UPDATE alert_instance
           SET status = ${status},
               -- Adiado sem data até quando é um alerta que nunca volta: o banco
               -- recusa, e aqui a data é limpa quando o status sai de adiado.
               snooze_until = ${status === 'snoozed' ? snoozeUntil : null}
         WHERE rule_kind = ${key.rule_kind}
           AND subject_id = ${key.subject_id}
        RETURNING *
      `;

      const row = rows[0];

      return success(row === undefined ? null : parseAlertInstanceFromDB(row));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
