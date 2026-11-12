import type { FinCardItem, FinEntry, FinSnapshot } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { rule } from './errors.js';
import type { FinRuleError } from './errors.js';
import { applyEntryEdit } from './installments_edit.js';
import type { EntryDraft } from './entries.js';

/**
 * Editar ou excluir uma compra parcelada pergunta o alcance: só esta parcela,
 * esta e as seguintes, ou todas. Sem escopo, a operação é recusada com
 * `INSTALLMENT_SCOPE_REQUIRED` (422).
 *
 * Parcela já lançada não é alterada por "seguintes" aplicado a uma anterior: o
 * escopo atinge a escolhida e as parcelas seguintes ainda previstas. "Todas"
 * atinge o grupo inteiro.
 */

export const INSTALLMENT_SCOPES = ['esta', 'seguintes', 'todas'] as const;
export type InstallmentScope = (typeof INSTALLMENT_SCOPES)[number];

export const scopeRequired = (): FinRuleError =>
  rule(
    'INSTALLMENT_SCOPE_REQUIRED',
    'Esta é uma compra parcelada: informe se vale para esta parcela, esta e as seguintes ou todas.',
    { field: 'scope' },
  );

export const scopeInvalid = (): FinRuleError =>
  rule('INSTALLMENT_SCOPE_INVALID', 'O escopo só vale para compra parcelada.', {
    field: 'scope',
  });

/** As parcelas de uma compra de Lançamentos atingidas pelo escopo, em ordem de parcela. */
export const entryTargets = (
  data: FinSnapshot,
  id: string,
  scope: InstallmentScope,
): readonly FinEntry[] => {
  const base = data.entries.find((entry) => entry.id === id);
  if (base === undefined) return [];
  if (base.installment === null)
    return scope === 'todas' || scope === 'esta' ? [base] : [base];

  const group = base.installment.group_id;
  const from = base.installment.no;
  return data.entries
    .filter((entry) => entry.installment?.group_id === group)
    .filter((entry) => {
      const no = entry.installment?.no ?? 0;
      if (scope === 'todas') return true;
      if (scope === 'esta') return no === from;
      return no === from || (no > from && entry.status === 'prevista');
    })
    .sort((a, b) => (a.installment?.no ?? 0) - (b.installment?.no ?? 0));
};

/** As parcelas de um item que só a fatura tem, atingidas pelo escopo. */
export const itemTargets = (
  data: FinSnapshot,
  id: string,
  scope: InstallmentScope,
): readonly FinCardItem[] => {
  const base = data.card_items.find((item) => item.id === id);
  if (base === undefined) return [];
  if (base.installment === null) return [base];

  const group = base.installment.group_id;
  const from = base.installment.no;
  return data.card_items
    .filter((item) => item.installment?.group_id === group)
    .filter((item) => {
      const no = item.installment?.no ?? 0;
      return scope === 'todas' ? true : scope === 'esta' ? no === from : no >= from;
    })
    .sort((a, b) => (a.installment?.no ?? 0) - (b.installment?.no ?? 0));
};

export const isInstallment = (entry: FinEntry): boolean => entry.installment !== null;

export const deleteInstallments = (
  data: FinSnapshot,
  id: string,
  scope: InstallmentScope,
): FinSnapshot => {
  const ids = new Set(entryTargets(data, id, scope).map((entry) => entry.id));
  return ids.size === 0
    ? data
    : { ...data, entries: data.entries.filter((entry) => !ids.has(entry.id)) };
};

/** Descrição, categoria, valor e origem passam para as parcelas do escopo; as datas ficam. */
export const updateInstallments = (
  data: FinSnapshot,
  id: string,
  draft: EntryDraft,
  scope: InstallmentScope,
): Either<readonly FinRuleError[], FinSnapshot> => {
  const targets = entryTargets(data, id, scope);
  if (targets.length === 0) {
    return failure([
      rule('ENTRY_NOT_FOUND', 'Lançamento não encontrado.', { status: 404 }),
    ]);
  }
  return applyEntryEdit(data, targets, draft);
};

export { success };
