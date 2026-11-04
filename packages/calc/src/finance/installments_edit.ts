import type { FinEntry, FinPayment, FinSnapshot } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { validateEntryDraft } from './entries.js';
import type { EntryDraft } from './entries.js';
import type { FinRuleError } from './errors.js';
import { dec, money } from './money.js';
import { makePayment } from './recurring.js';

/**
 * A edição em lote das parcelas de um escopo. Cada parcela recebe os campos
 * novos mantendo a sua data e o seu número; o valor é o da parcela informada
 * (`draft.amount`), igual para todas as atingidas. Tudo ou nada: se o rascunho é
 * inválido, nenhuma parcela muda.
 */
export const applyEntryEdit = (
  data: FinSnapshot,
  targets: readonly FinEntry[],
  draft: EntryDraft,
): Either<readonly FinRuleError[], FinSnapshot> => {
  const first = targets[0];
  const errors = validateEntryDraft(
    data,
    { ...draft, installments: 1 },
    { allowArchivedCategoryId: first?.category_id },
  );
  if (errors.length > 0) return failure(errors);

  const ids = new Set(targets.map((entry) => entry.id));
  const source = draft.payments[0];
  const entries = data.entries.map((entry): FinEntry => {
    if (!ids.has(entry.id) || source === undefined) return entry;
    const payments: readonly FinPayment[] = [
      makePayment(
        data,
        { type: source.source_type, id: source.source_id },
        dec(draft.amount),
        entry.date,
      ),
    ];
    return {
      ...entry,
      description: draft.description.trim(),
      category_id: draft.category_id,
      amount: money(dec(draft.amount)),
      payments,
      note: draft.note === undefined ? entry.note : draft.note,
    };
  });
  return success({ ...data, entries });
};
