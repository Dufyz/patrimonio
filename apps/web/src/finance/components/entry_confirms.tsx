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
import { useFinanceData } from '../store/finance_store.js';

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
  const data = useFinanceData();
  const [sourceId, setSourceId] = useState('');
  const hasIncome = entries.some((entry) => entry.kind === 'receita');
  const options = allowedSources(data, hasIncome ? 'receita' : 'despesa')
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

/** Recategorizar em lote: só categorias do tipo comum às linhas marcadas. */
export const RecategorizeDialog = ({
  entries,
  categories,
  onConfirm,
  onClose,
}: {
  readonly entries: readonly Entry[];
  readonly categories: readonly {
    readonly id: string;
    readonly name: string;
    readonly kind: string;
  }[];
  readonly onConfirm: (categoryId: string) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [categoryId, setCategoryId] = useState('');
  const kinds = new Set(entries.map((entry) => entry.kind));
  const mixed = kinds.size > 1;
  const options = categories
    .filter((category) => kinds.has(category.kind as Entry['kind']))
    .map((category) => ({ id: category.id, name: category.name }));

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Recategorizar</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <DialogDescription className="text-[0.8125rem] text-ink-2">
            {mixed
              ? 'Receitas e despesas têm categorias diferentes. Selecione só um tipo para recategorizar.'
              : `Escolha a categoria dos ${entries.length} lançamentos.`}
          </DialogDescription>
          {mixed ? null : (
            <Field label="Categoria">
              {(props) => (
                <Select
                  {...props}
                  invalid={false}
                  placeholder="Escolha uma categoria"
                  options={options}
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                />
              )}
            </Field>
          )}
        </DialogBody>
        <DialogFooter className="justify-end">
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={mixed || categoryId === ''}
            onClick={() => onConfirm(categoryId)}
          >
            Recategorizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
