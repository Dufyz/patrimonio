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
import { Checkbox } from '../../components/ui/checkbox.js';
import { Field, Input, MoneyInput, Select } from '../../views/entry/fields.js';
import {
  FUTURE_DATE,
  allowedSources,
  canInstall,
  installmentSummary,
  splitDifference,
  validateEntry,
} from '../domain/entry_ops.js';
import type { EntryDraft } from '../domain/entry_ops.js';
import type { EntryKind, FinanceData } from '../domain/types.js';
import { formatBRL } from '../lib/format.js';
import { parseMoneyInput } from '../lib/format.js';

/**
 * FIN-306 e FIN-307 · O modal de lançamento.
 *
 * `launch` confirma um previsto com o valor real: descrição, categoria e origem
 * vêm do previsto e só data e valores se editam. `new` e `edit` pedem tipo,
 * descrição, data, categoria, valor e origem, com opção de duas origens cuja
 * diferença aparece em tempo real e trava o salvar enquanto não fechar (RN-21).
 */

export type EntryDialogMode = 'new' | 'edit' | 'launch';

const TITLES: Readonly<Record<EntryDialogMode, string>> = {
  new: 'Novo lançamento',
  edit: 'Editar lançamento',
  launch: 'Lançar previsto',
};

const KINDS: readonly { readonly id: EntryKind; readonly name: string }[] = [
  { id: 'despesa', name: 'Despesa' },
  { id: 'receita', name: 'Receita' },
];

export const EntryDialog = ({
  mode,
  data,
  initial,
  today,
  onSave,
  onClose,
  onCreateRecurring,
}: {
  readonly mode: EntryDialogMode;
  readonly data: FinanceData;
  readonly initial: EntryDraft;
  readonly today: string;
  readonly onSave: (draft: EntryDraft) => void;
  readonly onClose: () => void;
  /** Para algo futuro, o modal oferece criar um recorrente. */
  readonly onCreateRecurring?: (() => void) | undefined;
}): React.ReactElement => {
  const [draft, setDraft] = useState<EntryDraft>(initial);
  const [attempted, setAttempted] = useState(false);

  const errors = validateEntry(data, draft, today);
  const shown = (field: keyof typeof errors): string | undefined =>
    attempted ? errors[field] : undefined;
  const set = (patch: Partial<EntryDraft>): void => setDraft({ ...draft, ...patch });

  const locked = mode === 'launch';
  const diff = splitDifference(draft);
  const blocked = diff !== null && diff !== 0;

  const categories = data.categories
    .filter((category) => category.kind === draft.kind)
    .map((category) => ({ id: category.id, name: category.name }));
  const sources = allowedSources(data, draft.kind).map((s) => ({
    id: s.id,
    name: s.name,
  }));

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    onSave(draft);
  };

  /** Com divisão, mudar o valor total ajusta a segunda parte para fechar a soma. */
  const onValue = (value: string): void => {
    const total = parseMoneyInput(value);
    const first = parseMoneyInput(draft.firstValue);
    if (draft.split && total !== null && first !== null && total > first) {
      set({ value, secondValue: ((total - first) / 100).toFixed(2).replace('.', ',') });
    } else set({ value });
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{TITLES[mode]}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Tipo">
                {(props) => (
                  <Select
                    {...props}
                    invalid={false}
                    disabled={locked}
                    options={KINDS}
                    value={draft.kind}
                    onChange={(event) => {
                      const kind = event.target.value as EntryKind;
                      const keepCategory = data.categories.some(
                        (c) => c.id === draft.categoryId && c.kind === kind,
                      );
                      const keepSource = allowedSources(data, kind).some(
                        (s) => s.id === draft.sourceId,
                      );
                      set({
                        kind,
                        categoryId: keepCategory ? draft.categoryId : '',
                        sourceId: keepSource ? draft.sourceId : '',
                        ...(kind === 'receita' ? { split: false } : {}),
                      });
                    }}
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

            <Field label="Descrição" error={shown('description')}>
              {(props) => (
                <Input
                  {...props}
                  autoFocus={!locked}
                  disabled={locked}
                  invalid={shown('description') !== undefined}
                  value={draft.description}
                  onChange={(event) => set({ description: event.target.value })}
                />
              )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Categoria" error={shown('categoryId')}>
                {(props) => (
                  <Select
                    {...props}
                    disabled={locked}
                    invalid={shown('categoryId') !== undefined}
                    placeholder="Escolha"
                    options={categories}
                    value={draft.categoryId}
                    onChange={(event) => set({ categoryId: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Valor" error={shown('value')}>
                {(props) => (
                  <MoneyInput
                    {...props}
                    autoFocus={locked}
                    invalid={shown('value') !== undefined}
                    value={draft.value}
                    onChange={(event) => onValue(event.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className={draft.split ? 'grid grid-cols-2 gap-4' : ''}>
              <Field
                label={draft.split ? 'Origem' : 'Origem do pagamento'}
                error={shown('sourceId')}
              >
                {(props) => (
                  <Select
                    {...props}
                    disabled={locked}
                    invalid={shown('sourceId') !== undefined}
                    placeholder="Conta, benefício ou cartão"
                    options={sources}
                    value={draft.sourceId}
                    onChange={(event) => set({ sourceId: event.target.value })}
                  />
                )}
              </Field>
              {draft.split ? (
                <Field label="Parte desta origem" error={shown('firstValue')}>
                  {(props) => (
                    <MoneyInput
                      {...props}
                      invalid={shown('firstValue') !== undefined}
                      value={draft.firstValue}
                      onChange={(event) => set({ firstValue: event.target.value })}
                    />
                  )}
                </Field>
              ) : null}
            </div>

            {draft.date > today && onCreateRecurring !== undefined ? (
              <p className="text-xs text-ink-3">
                {FUTURE_DATE}{' '}
                <button
                  type="button"
                  className="cursor-pointer font-medium text-accent underline"
                  onClick={onCreateRecurring}
                >
                  Criar recorrente
                </button>
              </p>
            ) : null}

            {canInstall(data, draft) && mode !== 'launch' ? (
              <Field
                label="Parcelas"
                error={shown('installments')}
                hint={installmentSummary(data, draft) ?? 'À vista'}
              >
                {(props) => (
                  <Input
                    {...props}
                    numeric
                    inputMode="numeric"
                    invalid={shown('installments') !== undefined}
                    value={draft.installments}
                    onChange={(event) =>
                      set({ installments: event.target.value.replace(/\D/g, '') })
                    }
                  />
                )}
              </Field>
            ) : null}

            {draft.kind === 'despesa' && !locked ? (
              <label className="flex items-center gap-2 text-[0.8125rem]">
                <Checkbox
                  checked={draft.split}
                  onCheckedChange={(checked) => set({ split: checked === true })}
                />
                Dividir em duas origens
              </label>
            ) : null}

            {draft.split ? (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Segunda origem" error={shown('secondSourceId')}>
                  {(props) => (
                    <Select
                      {...props}
                      disabled={locked}
                      invalid={shown('secondSourceId') !== undefined}
                      placeholder="Escolha"
                      options={sources}
                      value={draft.secondSourceId}
                      onChange={(event) => set({ secondSourceId: event.target.value })}
                    />
                  )}
                </Field>
                <Field label="Parte desta origem" error={shown('secondValue')}>
                  {(props) => (
                    <MoneyInput
                      {...props}
                      invalid={shown('secondValue') !== undefined}
                      value={draft.secondValue}
                      onChange={(event) => set({ secondValue: event.target.value })}
                    />
                  )}
                </Field>
              </div>
            ) : null}

            {diff === null ? null : (
              <p
                role="status"
                className={`tabular text-xs ${diff === 0 ? 'text-positive' : 'text-negative'}`}
              >
                {diff === 0
                  ? 'As partes fecham com o valor.'
                  : diff > 0
                    ? `Faltam ${formatBRL(diff)} para fechar o valor.`
                    : `As partes passam ${formatBRL(-diff)} do valor.`}
              </p>
            )}
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" type="submit" disabled={blocked}>
              {mode === 'launch' ? 'Lançar' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
