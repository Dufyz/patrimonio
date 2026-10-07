import type { AlertInstance, AlertStatus, DateOnly } from '@patrimonio/domain';

import type { AlertFinding } from '../interfaces/alert.repository.js';

/**
 * O alerta é a única projeção com estado que o usuário mexe: adiar e ignorar. Esse
 * estado precisa sobreviver ao recálculo, e é isso que esta função garante.
 *
 * A reconciliação é por `(rule_kind, subject_id)`. Apagar e regravar seria uma
 * linha de SQL mais curta e perderia a decisão do usuário: o alerta que ele
 * adiou para a semana que vem voltaria à frente dele no fechamento de hoje, e é
 * assim que se aprende a ignorar o painel inteiro.
 *
 * Função pura: nada de I/O, e a data de hoje entra por parâmetro.
 */
export type AlertUpsert = {
  readonly rule_kind: string;
  readonly subject_id: string;
  readonly portfolio_id: string | null;
  readonly payload: Record<string, unknown>;
  /**
   * O status a gravar. Num alerta que já existia é o status atual — a decisão do
   * usuário —, e num alerta novo é `open`.
   */
  readonly status: AlertStatus;
  readonly snooze_until: DateOnly | null;
};

export type AlertKey = {
  readonly rule_kind: string;
  readonly subject_id: string;
};

export type AlertsPlan = {
  /** Alertas novos e alertas que continuam valendo, com o texto atualizado. */
  readonly upserts: readonly AlertUpsert[];
  /** Deixaram de valer: o item foi resolvido, e a linha sai. */
  readonly resolved: readonly AlertKey[];
  readonly report: {
    readonly opened: number;
    readonly updated: number;
    readonly resolved: number;
    readonly preserved: number;
  };
};

export type AlertsContext = {
  /** As instâncias que já existem para as regras executadas neste escopo. */
  readonly existing: readonly AlertInstance[];
  /** O que a execução das regras encontrou agora. */
  readonly findings: readonly AlertFinding[];
};

const keyOf = (item: AlertKey): string => `${item.rule_kind}\u0000${item.subject_id}`;

export const reconcileAlerts = (context: AlertsContext): AlertsPlan => {
  const existing = new Map(context.existing.map((item) => [keyOf(item), item]));
  const seen = new Set<string>();

  const upserts: AlertUpsert[] = [];
  let opened = 0;
  let updated = 0;
  let preserved = 0;

  for (const finding of context.findings) {
    const key = keyOf(finding);
    seen.add(key);

    const current = existing.get(key);

    if (current === undefined) {
      opened += 1;
      upserts.push({
        rule_kind: finding.rule_kind,
        subject_id: finding.subject_id,
        portfolio_id: finding.portfolio_id,
        payload: finding.payload,
        status: 'open',
        snooze_until: null,
      });
      continue;
    }

    updated += 1;
    // O `status` que vai para o banco é o que já estava lá: o payload é do motor,
    // a decisão é do usuário, e o recálculo não tem licença para desfazê-la.
    if (current.status !== 'open') preserved += 1;

    upserts.push({
      rule_kind: finding.rule_kind,
      subject_id: finding.subject_id,
      portfolio_id: finding.portfolio_id,
      payload: finding.payload,
      status: current.status,
      snooze_until: current.snooze_until,
    });
  }

  const resolved = context.existing
    .filter((item) => !seen.has(keyOf(item)))
    .map((item) => ({ rule_kind: item.rule_kind, subject_id: item.subject_id }));

  return {
    upserts,
    resolved,
    report: { opened, updated, resolved: resolved.length, preserved },
  };
};

/**
 * O que o painel mostra hoje: aberto, mais adiado cuja data já chegou. Ignorado
 * nunca volta para o mesmo item — foi uma decisão sobre aquele item, não sobre a
 * regra, e por isso a regra continua valendo para os outros.
 */
export const isVisibleOn = (alert: AlertInstance, date: DateOnly): boolean => {
  switch (alert.status) {
    case 'open':
      return true;
    case 'ignored':
      return false;
    case 'snoozed':
      return alert.snooze_until !== null && alert.snooze_until <= date;
  }
};

/** Os três grupos do painel, pelo que o usuário precisa fazer com cada item. */
export const ALERT_GROUPS = ['corrigir', 'decidir', 'acompanhar'] as const;

export type AlertGroup = (typeof ALERT_GROUPS)[number];
