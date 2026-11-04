import { useState } from 'react';

import { Button } from '../../components/primitives.js';
import { Modal } from '../../components/overlay.js';
import { Callout } from '../../views/entry/fields.js';
import { FormShell } from '../../views/entry/form_shell.js';
import { Field, Input, Select } from '../../views/entry/fields.js';
import {
  canChangeKind,
  categoryReferences,
  replacementOptions,
  validateCategory,
} from '../domain/category_ops.js';
import type { CategoryDraft } from '../domain/category_ops.js';
import type { Category, EntryKind, FinanceData } from '../domain/types.js';
import { CATEGORY_PALETTE, categoryColor } from '../lib/category_colors.js';
import { cn } from '../../lib/cn.js';

/**
 * FIN-102 · Os modais de categoria: nova ou editar (nome, tipo e cor, sem mais
 * campos) e a confirmação de exclusão, que pede a categoria de destino quando
 * há lançamentos.
 */

const KIND_OPTIONS: readonly { readonly id: EntryKind; readonly name: string }[] = [
  { id: 'despesa', name: 'Despesa' },
  { id: 'receita', name: 'Receita' },
];

export const CategoryDialog = ({
  data,
  category,
  onSave,
  onClose,
}: {
  readonly data: FinanceData;
  /** Ausente em "Nova categoria". */
  readonly category?: Category | undefined;
  readonly onSave: (draft: CategoryDraft) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<CategoryDraft>({
    name: category?.name ?? '',
    kind: category?.kind ?? 'despesa',
    color: category?.color ?? CATEGORY_PALETTE[0].id,
  });
  const [attempted, setAttempted] = useState(false);

  const errors = validateCategory(data, draft, category?.id);
  const kindLocked = category !== undefined && !canChangeKind(data, category.id);
  const title = category === undefined ? 'Nova categoria' : 'Editar categoria';

  const save = (): void => {
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    onSave(draft);
  };

  return (
    <Modal
      open
      guard
      narrow
      title={title}
      subtitle="Categorias organizam receitas e despesas"
      onClose={onClose}
    >
      <FormShell pending={false} onSave={save} onCancel={onClose} saveLabel="Salvar">
        <Field label="Nome" error={attempted ? errors.name : undefined}>
          {(props) => (
            <Input
              {...props}
              invalid={attempted && errors.name !== undefined}
              value={draft.name}
              autoFocus
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          )}
        </Field>

        <Field
          label="Tipo"
          hint={kindLocked ? 'Só categoria sem lançamentos muda de tipo.' : undefined}
        >
          {(props) => (
            <Select
              {...props}
              invalid={false}
              disabled={kindLocked}
              options={KIND_OPTIONS}
              value={draft.kind}
              onChange={(event) =>
                setDraft({ ...draft, kind: event.target.value as EntryKind })
              }
            />
          )}
        </Field>

        <div className="flex flex-col gap-1.5">
          <span id="cor-label" className="text-xs font-medium text-ink-2">
            Cor
          </span>
          <div
            role="radiogroup"
            aria-labelledby="cor-label"
            className="flex flex-wrap gap-2"
          >
            {CATEGORY_PALETTE.map((color) => (
              <button
                key={color.id}
                type="button"
                role="radio"
                aria-checked={draft.color === color.id}
                aria-label={color.label}
                title={color.label}
                onClick={() => setDraft({ ...draft, color: color.id })}
                className={cn(
                  'size-7 cursor-pointer rounded-control border-2 border-transparent outline-none focus-visible:ring-2 focus-visible:ring-accent-soft',
                  draft.color === color.id && 'border-ink',
                )}
                style={{ backgroundColor: categoryColor(color.id) }}
              />
            ))}
          </div>
        </div>
        <Callout tone="info">
          Ao apagar uma categoria que já tem lançamentos, o sistema pergunta para qual
          categoria mover. Investimento e Gasto livre são categorias comuns e podem ser
          editadas.
        </Callout>
      </FormShell>
    </Modal>
  );
};

export const DeleteCategoryDialog = ({
  data,
  category,
  onConfirm,
  onClose,
}: {
  readonly data: FinanceData;
  readonly category: Category;
  readonly onConfirm: (replacementId: string | null) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const references = categoryReferences(data, category.id);
  const options = replacementOptions(data, category.id);
  const [replacement, setReplacement] = useState('');
  const needsReplacement = references > 0;
  const blocked = needsReplacement && replacement === '';

  return (
    <Modal
      open
      narrow
      title="Excluir categoria"
      tone="danger"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="danger"
            disabled={blocked}
            onClick={() => onConfirm(needsReplacement ? replacement : null)}
          >
            Excluir
          </Button>
        </>
      }
    >
      <p className="text-[0.8125rem] text-ink-2">
        {needsReplacement
          ? `“${category.name}” tem ${references} ${references === 1 ? 'lançamento' : 'lançamentos'}. Escolha a categoria que vai recebê-los.`
          : `Excluir “${category.name}”? Essa ação não pode ser desfeita.`}
      </p>
      {needsReplacement ? (
        <Field label="Mover para">
          {(props) => (
            <Select
              {...props}
              invalid={false}
              placeholder="Escolha uma categoria"
              options={options}
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
            />
          )}
        </Field>
      ) : null}
    </Modal>
  );
};
