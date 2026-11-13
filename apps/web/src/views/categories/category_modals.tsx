import { useState } from 'react';

import {
  createFinanceCategory,
  deleteFinanceCategory,
  deleteFinanceCategoryMoving,
  updateFinanceCategory,
} from '../../api/finance_categories.js';
import type { CategoryRequest } from '../../api/finance_categories.js';
import { ApiError } from '../../api/client.js';
import { AlertModal, Modal } from '../../components/overlay.js';
import { CATEGORY_PALETTE, categoryColor } from '../../finance/lib/category_colors.js';
import { newAttemptKey } from '../../lib/entry.js';
import type { CategoryItem, CategoryLine } from '../../lib/category_view.js';
import { Field, Input, Select } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';

/**
 * CAT-03 · Nova, editar e excluir categoria. O tipo só muda em categoria sem
 * lançamentos; a natureza (fixa ou livre) é só da despesa; excluir categoria em
 * uso pede o destino e, depois, uma segunda confirmação com a contagem.
 */
const KIND_OPTIONS = [
  { id: 'despesa', name: 'Despesa' },
  { id: 'receita', name: 'Receita' },
] as const;

const NATURE_OPTIONS = [
  { id: 'livre', name: 'Livre' },
  { id: 'fixa', name: 'Fixa' },
] as const;

export const CategoryModal = ({
  editing,
  entriesTotal,
  existing,
  onSaved,
  onClose,
}: {
  readonly editing?: CategoryItem | undefined;
  /** Quantos lançamentos a categoria tem: com algum, o tipo fica travado. */
  readonly entriesTotal: number;
  readonly existing: readonly CategoryItem[];
  readonly onSaved: () => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [name, setName] = useState(editing?.name ?? '');
  const [kind, setKind] = useState<'receita' | 'despesa'>(editing?.kind ?? 'despesa');
  const [nature, setNature] = useState<'fixa' | 'livre'>(editing?.nature ?? 'livre');
  const [color, setColor] = useState(editing?.color ?? CATEGORY_PALETTE[0].id);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const trimmed = name.trim();
  const duplicate = existing.some(
    (c) =>
      c.id !== editing?.id &&
      c.kind === kind &&
      c.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const nameError =
    trimmed === ''
      ? 'Informe o nome da categoria.'
      : duplicate
        ? 'Já existe uma categoria com esse nome neste tipo.'
        : undefined;
  const locked = editing !== undefined && entriesTotal > 0;

  const submit = async (): Promise<void> => {
    setAttempted(true);
    if (nameError !== undefined) return;
    setPending(true);
    setFailure(null);
    const body: CategoryRequest = {
      name: trimmed,
      kind,
      color,
      nature: kind === 'despesa' ? nature : null,
    };
    try {
      if (editing === undefined) await createFinanceCategory(body, newAttemptKey());
      else await updateFinanceCategory(editing.id, body, newAttemptKey());
      onSaved();
      onClose();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      guard
      narrow
      title={editing === undefined ? 'Nova categoria' : 'Editar categoria'}
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={failure}
        saveLabel={editing === undefined ? 'Criar categoria' : 'Salvar'}
        onSave={() => void submit()}
        onCancel={onClose}
      >
        <Field label="Nome" error={attempted ? nameError : undefined}>
          {(p) => (
            <Input
              {...p}
              invalid={p['aria-invalid']}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Tipo"
          hint={locked ? 'Categoria com lançamentos não muda de tipo.' : undefined}
        >
          {(p) => (
            <Select
              {...p}
              invalid={false}
              disabled={locked}
              options={KIND_OPTIONS}
              value={kind}
              onChange={(e) => setKind(e.target.value as 'receita' | 'despesa')}
            />
          )}
        </Field>
        {kind === 'despesa' ? (
          <Field label="Natureza">
            {(p) => (
              <Select
                {...p}
                invalid={false}
                options={NATURE_OPTIONS}
                value={nature}
                onChange={(e) => setNature(e.target.value as 'fixa' | 'livre')}
              />
            )}
          </Field>
        ) : null}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-ink-2">Cor</legend>
          <div role="radiogroup" aria-label="Cor" className="flex flex-wrap gap-2">
            {CATEGORY_PALETTE.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={color === option.id}
                aria-label={option.label}
                title={option.label}
                className={`size-6 cursor-pointer rounded-full border-2 ${
                  color === option.id ? 'border-ink' : 'border-transparent'
                }`}
                style={{ backgroundColor: categoryColor(option.id) }}
                onClick={() => setColor(option.id)}
              />
            ))}
          </div>
        </fieldset>
      </FormShell>
    </Modal>
  );
};

export const DeleteCategoryModal = ({
  category,
  candidates,
  onDeleted,
  onClose,
}: {
  readonly category: CategoryLine;
  /** Categorias do mesmo tipo, sem a que sai: os destinos possíveis. */
  readonly candidates: readonly CategoryItem[];
  readonly onDeleted: () => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const inUse = category.entriesTotal > 0;
  const options = candidates.filter((c) => c.id !== category.id && !c.archived);
  const [destination, setDestination] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setPending(true);
    setFailure(null);
    try {
      if (inUse) {
        await deleteFinanceCategoryMoving(category.id, destination, newAttemptKey());
      } else {
        await deleteFinanceCategory(category.id, newAttemptKey());
      }
      onDeleted();
      onClose();
    } catch (error) {
      setConfirming(false);
      setFailure(error instanceof ApiError ? error.message : 'Não foi possível excluir.');
    } finally {
      setPending(false);
    }
  };

  if (!inUse) {
    return (
      <AlertModal
        open
        title={`Excluir ${category.name}?`}
        message="A categoria não tem lançamentos e será removida."
        cancelLabel="Cancelar"
        confirmLabel="Excluir"
        pending={pending}
        onCancel={onClose}
        onConfirm={() => void run()}
      />
    );
  }

  const destinationName = options.find((c) => c.id === destination)?.name ?? '';
  return confirming ? (
    <AlertModal
      open
      title="Confirmar exclusão"
      message={`${category.entriesTotal} ${
        category.entriesTotal === 1 ? 'lançamento' : 'lançamentos'
      } de "${category.name}" (e os recorrentes dela) vão para "${destinationName}". Não dá para desfazer.`}
      cancelLabel="Voltar"
      confirmLabel="Excluir e mover"
      pending={pending}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void run()}
    />
  ) : (
    <Modal open guard narrow title={`Excluir ${category.name}`} onClose={onClose}>
      <FormShell
        pending={false}
        error={failure}
        saveLabel="Continuar"
        saveShortcut={null}
        canSave={destination !== ''}
        onSave={() => setConfirming(true)}
        onCancel={onClose}
      >
        <p className="text-[0.8125rem] text-ink-2">
          Esta categoria tem {category.entriesTotal}{' '}
          {category.entriesTotal === 1 ? 'lançamento' : 'lançamentos'}. Escolha a
          categoria que vai recebê-los, com os recorrentes.
        </p>
        <Field label="Mover para">
          {(p) => (
            <Select
              {...p}
              invalid={false}
              placeholder="Escolha o destino"
              options={options}
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          )}
        </Field>
      </FormShell>
    </Modal>
  );
};
