import { useState } from 'react';

import { Button } from '../../components/primitives.js';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Field, Input, MoneyInput, Select } from '../../views/entry/fields.js';
import {
  CREDIT_TYPES,
  emptyCreditDraft,
  validateCardItem,
} from '../domain/card_item_ops.js';
import type { CreditDraft } from '../domain/card_item_ops.js';
import type { CreditType, FinanceData } from '../domain/types.js';

/** FIN-508 · Lançar crédito na fatura exibida: devolução, estorno, desconto ou cashback. */
export const CreditDialog = ({
  data,
  today,
  onSave,
  onClose,
}: {
  readonly data: FinanceData;
  readonly today: string;
  readonly onSave: (draft: CreditDraft) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<CreditDraft>(() => emptyCreditDraft(today));
  const [attempted, setAttempted] = useState(false);
  const errors = validateCardItem(draft, true);
  const shown = (field: keyof typeof errors): string | undefined =>
    attempted ? errors[field] : undefined;
  const set = (patch: Partial<CreditDraft>): void => setDraft({ ...draft, ...patch });
  const categories = data.categories
    .filter((category) => category.kind === 'despesa')
    .map((category) => ({ id: category.id, name: category.name }));

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <form
          noValidate
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            setAttempted(true);
            if (Object.keys(errors).length === 0) onSave(draft);
          }}
        >
          <DialogHeader>
            <DialogTitle>Lançar crédito</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field label="Tipo">
              {(props) => (
                <Select
                  {...props}
                  invalid={false}
                  options={CREDIT_TYPES}
                  value={draft.subtype}
                  onChange={(event) => set({ subtype: event.target.value as CreditType })}
                />
              )}
            </Field>
            <Field label="Descrição" error={shown('description')}>
              {(props) => (
                <Input
                  {...props}
                  autoFocus
                  invalid={shown('description') !== undefined}
                  value={draft.description}
                  onChange={(event) => set({ description: event.target.value })}
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
                  placeholder="Categoria da compra"
                  options={categories}
                  value={draft.categoryId}
                  onChange={(event) => set({ categoryId: event.target.value })}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              Lançar crédito
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
