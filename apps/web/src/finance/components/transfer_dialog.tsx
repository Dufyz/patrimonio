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
  emptyTransferDraft,
  transferAccounts,
  validateTransfer,
} from '../domain/transfer_ops.js';
import type { TransferDraft } from '../domain/transfer_ops.js';
import type { FinanceData } from '../domain/types.js';

/**
 * FIN-403 · O modal de transferência. Aberto de uma conta (a tela de Contas, o
 * menu `⋯` ou o Extrato), a origem já vem preenchida.
 */
export const TransferDialog = ({
  data,
  today,
  fromId = '',
  onSave,
  onClose,
}: {
  readonly data: FinanceData;
  readonly today: string;
  readonly fromId?: string;
  readonly onSave: (draft: TransferDraft) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<TransferDraft>(() =>
    emptyTransferDraft(today, fromId),
  );
  const [attempted, setAttempted] = useState(false);

  const errors = validateTransfer(data, draft, today);
  const shown = (field: keyof typeof errors): string | undefined =>
    attempted ? errors[field] : undefined;
  const set = (patch: Partial<TransferDraft>): void => setDraft({ ...draft, ...patch });
  const options = transferAccounts(data).map((a) => ({ id: a.id, name: a.name }));

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    onSave(draft);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>Transferir entre contas</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="grid grid-cols-2 gap-4">
              <Field label="De" error={shown('fromId')}>
                {(props) => (
                  <Select
                    {...props}
                    invalid={shown('fromId') !== undefined}
                    placeholder="Conta de origem"
                    options={options}
                    value={draft.fromId}
                    onChange={(event) => set({ fromId: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Para" error={shown('toId')}>
                {(props) => (
                  <Select
                    {...props}
                    invalid={shown('toId') !== undefined}
                    placeholder="Conta de destino"
                    options={options}
                    value={draft.toId}
                    onChange={(event) => set({ toId: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Valor" error={shown('value')}>
                {(props) => (
                  <MoneyInput
                    {...props}
                    autoFocus={draft.fromId !== ''}
                    invalid={shown('value') !== undefined}
                    value={draft.value}
                    onChange={(event) => set({ value: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Data" error={shown('date')}>
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    max={today}
                    invalid={shown('date') !== undefined}
                    value={draft.date}
                    onChange={(event) => set({ date: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <Field label="Descrição (opcional)">
              {(props) => (
                <Input
                  {...props}
                  invalid={false}
                  value={draft.description}
                  onChange={(event) => set({ description: event.target.value })}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              Transferir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
