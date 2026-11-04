import { useState } from 'react';

import { Button } from '../../components/primitives.js';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Field, Select } from '../../views/entry/fields.js';
import { allowedSources } from '../domain/entry_ops.js';
import type { Entry } from '../domain/types.js';

/** FIN-308 e FIN-309 · As confirmações de lançamento: excluir e mover de conta. */

export const ConfirmDialog = ({
  title,
  confirmLabel,
  danger = false,
  children,
  onConfirm,
  onClose,
}: {
  readonly title: string;
  readonly confirmLabel: string;
  readonly danger?: boolean;
  readonly children: React.ReactNode;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): React.ReactElement => (
  <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <DialogDescription asChild>
          <div className="flex flex-col gap-2 text-[0.8125rem] text-ink-2">
            {children}
          </div>
        </DialogDescription>
      </DialogBody>
      <DialogFooter className="justify-end">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/** Mover de conta: a origem nova é uma conta (receita) ou conta, benefício (despesa). */
export const MoveAccountDialog = ({
  entries,
  onConfirm,
  onClose,
}: {
  readonly entries: readonly Entry[];
  readonly onConfirm: (sourceId: string) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [sourceId, setSourceId] = useState('');
  const hasIncome = entries.some((entry) => entry.kind === 'receita');
  const options = allowedSources(hasIncome ? 'receita' : 'despesa')
    .filter((source) => source.type !== 'cartao')
    .map((source) => ({ id: source.id, name: source.name }));

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mover de conta</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription className="text-[0.8125rem] text-ink-2">
            {entries.length === 1
              ? `Escolha a conta que passa a pagar “${entries[0]?.description ?? ''}”.`
              : `Escolha a conta que passa a pagar os ${entries.length} lançamentos.`}
          </DialogDescription>
          <Field label="Mover para">
            {(props) => (
              <Select
                {...props}
                invalid={false}
                placeholder="Escolha uma conta"
                options={options}
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter className="justify-end">
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={sourceId === ''}
            onClick={() => onConfirm(sourceId)}
          >
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
