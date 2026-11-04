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
  CHARGE_TYPES,
  emptyChargeDraft,
  validateCharge,
} from '../domain/card_item_ops.js';
import type { ChargeDraft } from '../domain/card_item_ops.js';
import type { ChargeType } from '../domain/types.js';

/** FIN-512 · Lançar encargo (juros, multa ou IOF) na fatura exibida. */
export const ChargeDialog = ({
  today,
  onSave,
  onClose,
}: {
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

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
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
            <DialogTitle>Lançar encargo</DialogTitle>
          </DialogHeader>
          <DialogBody>
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
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              Lançar encargo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
