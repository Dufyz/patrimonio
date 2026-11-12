import { useState } from 'react';

import { Modal } from '../../components/overlay.js';
import { FormShell } from '../../views/entry/form_shell.js';
import { Field, Input, MoneyInput, Select } from '../../views/entry/fields.js';
import {
  CHARGE_TYPES,
  emptyChargeDraft,
  validateCharge,
} from '../domain/card_item_ops.js';
import type { ChargeDraft } from '../domain/card_item_ops.js';
import type { ChargeType, FinanceData } from '../domain/types.js';

/** FIN-512 · Lançar encargo (juros, multa ou IOF) na fatura exibida. */
export const ChargeDialog = ({
  data,
  today,
  onSave,
  onClose,
}: {
  readonly data: FinanceData;
  readonly today: string;
  readonly onSave: (draft: ChargeDraft) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<ChargeDraft>(() => emptyChargeDraft(today));
  const [attempted, setAttempted] = useState(false);
  const errors = validateCharge(draft);
  const shown = (field: keyof typeof errors): string | undefined =>
    attempted ? errors[field] : undefined;
  const set = (patch: Partial<ChargeDraft>): void => setDraft({ ...draft, ...patch });
  const categories = data.categories
    .filter((category) => category.kind === 'despesa')
    .map((category) => ({ id: category.id, name: category.name }));

  const save = (): void => {
    setAttempted(true);
    if (Object.keys(errors).length === 0) onSave(draft);
  };

  return (
    <Modal
      open
      guard
      narrow
      title="Lançar encargo"
      subtitle="Juros, multa ou IOF da fatura"
      onClose={onClose}
    >
      <FormShell
        pending={false}
        onSave={save}
        onCancel={onClose}
        saveLabel="Lançar encargo"
      >
        <Field label="Tipo">
          {(props) => (
            <Select
              {...props}
              invalid={false}
              options={CHARGE_TYPES}
              value={draft.subtype}
              onChange={(event) => set({ subtype: event.target.value as ChargeType })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Data" error={shown('date')}>
            {(props) => (
              <Input
                {...props}
                type="date"
                invalid={shown('date') !== undefined}
                value={draft.date}
                onChange={(event) => set({ date: event.target.value })}
              />
            )}
          </Field>
          <Field label="Valor" error={shown('value')}>
            {(props) => (
              <MoneyInput
                {...props}
                autoFocus
                invalid={shown('value') !== undefined}
                value={draft.value}
                onChange={(event) => set({ value: event.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label="Categoria" error={shown('categoryId')}>
          {(props) => (
            <Select
              {...props}
              invalid={shown('categoryId') !== undefined}
              placeholder="Categoria da despesa"
              options={categories}
              value={draft.categoryId}
              onChange={(event) => set({ categoryId: event.target.value })}
            />
          )}
        </Field>
      </FormShell>
    </Modal>
  );
};
