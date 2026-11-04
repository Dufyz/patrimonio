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
import { draftOfCardItem, validateCardItem } from '../domain/card_item_ops.js';
import type { CardItemDraft } from '../domain/card_item_ops.js';
import type { CardItem, FinanceData } from '../domain/types.js';

/** FIN-505 · Editar um item que só a fatura tem: compra resumida, crédito ou encargo. */
export const CardItemDialog = ({
  data,
  item,
  onSave,
  onClose,
}: {
  readonly data: FinanceData;
  readonly item: CardItem;
  readonly onSave: (draft: CardItemDraft) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<CardItemDraft>(() => draftOfCardItem(item));
  const [attempted, setAttempted] = useState(false);
  const needsCategory = item.categoryId !== undefined;
  const errors = validateCardItem(draft, needsCategory);
  const shown = (field: keyof typeof errors): string | undefined =>
    attempted ? errors[field] : undefined;
  const set = (patch: Partial<CardItemDraft>): void => setDraft({ ...draft, ...patch });
  const categories = data.categories
    .filter((category) => category.kind === 'despesa')
    .map((category) => ({ id: category.id, name: category.name }));
  const title =
    item.kind === 'credito'
      ? 'Editar crédito'
      : item.kind === 'encargo'
        ? 'Editar encargo'
        : 'Editar compra';

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
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
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
            {needsCategory ? (
              <Field label="Categoria" error={shown('categoryId')}>
                {(props) => (
                  <Select
                    {...props}
                    invalid={shown('categoryId') !== undefined}
                    options={categories}
                    value={draft.categoryId}
                    onChange={(event) => set({ categoryId: event.target.value })}
                  />
                )}
              </Field>
            ) : null}
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button type="button" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
