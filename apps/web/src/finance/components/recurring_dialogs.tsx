import { useState } from 'react';

import { Button } from '../../components/primitives.js';
import { Modal } from '../../components/overlay.js';
import { FormShell } from '../../views/entry/form_shell.js';
import { Checkbox } from '../../components/ui/checkbox.js';
import { Field, Input, MoneyInput, Select } from '../../views/entry/fields.js';
import { EffectTable } from './effect_table.js';
import { effectMonthLabel, recurringEffect } from '../domain/effects.js';
import { formatBRL, parseMoneyInput } from '../lib/format.js';
import { draftOf, validateRecurring } from '../domain/recurring.js';
import type { RecurringDraft } from '../domain/recurring.js';
import { activeSources } from '../domain/sources.js';
import type {
  EntryKind,
  FinanceData,
  Recurring,
  RecurringMode,
} from '../domain/types.js';

/**
 * FIN-202 · Os modais de recorrente: novo ou editar (item, tipo, categoria,
 * forma de pagamento com opção de duas origens, dia, modo, valor e situação) e
 * a confirmação de exclusão.
 */

const KINDS: readonly { readonly id: EntryKind; readonly name: string }[] = [
  { id: 'despesa', name: 'Despesa' },
  { id: 'receita', name: 'Receita' },
];

const MODES: readonly { readonly id: RecurringMode; readonly name: string }[] = [
  { id: 'automatico', name: 'Automático' },
  { id: 'manual', name: 'Manual' },
];

const STATES: readonly { readonly id: string; readonly name: string }[] = [
  { id: 'ativo', name: 'Ativo' },
  { id: 'pausado', name: 'Pausado' },
];

export const RecurringDialog = ({
  data,
  today,
  recurring,
  onSave,
  onClose,
}: {
  readonly data: FinanceData;
  readonly today: string;
  /** Ausente em "Novo recorrente". */
  readonly recurring?: Recurring | undefined;
  readonly onSave: (draft: RecurringDraft) => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<RecurringDraft>(() => draftOf(recurring));
  const [attempted, setAttempted] = useState(false);

  const errors = validateRecurring(data, draft);
  const shown = (field: keyof typeof errors): string | undefined =>
    attempted ? errors[field] : undefined;
  const set = (patch: Partial<RecurringDraft>): void => setDraft({ ...draft, ...patch });

  const categories = data.categories
    .filter((category) => category.kind === draft.kind)
    .map((category) => ({ id: category.id, name: category.name }));
  const sourceOptions = activeSources(data).map((s) => ({ id: s.id, name: s.name }));

  const total = parseMoneyInput(draft.value);
  const first = parseMoneyInput(draft.coversUpTo);
  const restLabel =
    total !== null && first !== null && total >= first ? formatBRL(total - first) : '—';

  const effect = recurringEffect(data, draft, today, recurring?.id);

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
      title={recurring === undefined ? 'Novo recorrente' : 'Editar recorrente'}
      subtitle="Gera um previsto todo mês"
      onClose={onClose}
    >
      <FormShell pending={false} onSave={save} onCancel={onClose} saveLabel="Salvar">
        <Field label="Item" error={shown('name')}>
          {(props) => (
            <Input
              {...props}
              autoFocus
              invalid={shown('name') !== undefined}
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Tipo">
            {(props) => (
              <Select
                {...props}
                invalid={false}
                options={KINDS}
                value={draft.kind}
                onChange={(event) => {
                  const kind = event.target.value as EntryKind;
                  const keep = data.categories.some(
                    (c) => c.id === draft.categoryId && c.kind === kind,
                  );
                  set({ kind, categoryId: keep ? draft.categoryId : '' });
                }}
              />
            )}
          </Field>
          <Field label="Categoria" error={shown('categoryId')}>
            {(props) => (
              <Select
                {...props}
                invalid={shown('categoryId') !== undefined}
                placeholder="Escolha"
                options={categories}
                value={draft.categoryId}
                onChange={(event) => set({ categoryId: event.target.value })}
              />
            )}
          </Field>
        </div>

        {draft.split ? (
          <fieldset className="grid gap-3 rounded-control border border-line p-3">
            <legend className="px-1 text-label tracking-[0.06em] text-ink-3 uppercase">
              Pagamento dividido
            </legend>
            <div className="grid grid-cols-[1fr_9rem] gap-3">
              <Field label="Origem 1" error={shown('sourceId')}>
                {(props) => (
                  <Select
                    {...props}
                    invalid={shown('sourceId') !== undefined}
                    placeholder="Conta ou cartão"
                    options={sourceOptions}
                    value={draft.sourceId}
                    onChange={(event) => set({ sourceId: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Valor da origem 1" error={shown('coversUpTo')}>
                {(props) => (
                  <MoneyInput
                    {...props}
                    invalid={shown('coversUpTo') !== undefined}
                    value={draft.coversUpTo}
                    onChange={(event) => set({ coversUpTo: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="grid grid-cols-[1fr_9rem] gap-3">
              <Field label="Origem 2" error={shown('secondSourceId')}>
                {(props) => (
                  <Select
                    {...props}
                    invalid={shown('secondSourceId') !== undefined}
                    placeholder="Escolha"
                    options={sourceOptions}
                    value={draft.secondSourceId}
                    onChange={(event) => set({ secondSourceId: event.target.value })}
                  />
                )}
              </Field>
              <Field label="Valor da origem 2" hint="O restante">
                {(props) => (
                  <Input
                    {...props}
                    invalid={false}
                    numeric
                    readOnly
                    tabIndex={-1}
                    value={restLabel}
                  />
                )}
              </Field>
            </div>
          </fieldset>
        ) : (
          <Field label="Pagamento" error={shown('sourceId')}>
            {(props) => (
              <Select
                {...props}
                invalid={shown('sourceId') !== undefined}
                placeholder="Conta ou cartão"
                options={sourceOptions}
                value={draft.sourceId}
                onChange={(event) => set({ sourceId: event.target.value })}
              />
            )}
          </Field>
        )}

        <label className="flex items-center gap-2 text-[0.8125rem]">
          <Checkbox
            checked={draft.split}
            onCheckedChange={(checked) => set({ split: checked === true })}
          />
          Dividir entre duas origens
        </label>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Dia do mês" error={shown('day')}>
            {(props) => (
              <Input
                {...props}
                numeric
                inputMode="numeric"
                invalid={shown('day') !== undefined}
                value={draft.day}
                onChange={(event) => set({ day: event.target.value.replace(/\D/g, '') })}
              />
            )}
          </Field>
          <Field label="Lançamento">
            {(props) => (
              <Select
                {...props}
                invalid={false}
                options={MODES}
                value={draft.mode}
                onChange={(event) => set({ mode: event.target.value as RecurringMode })}
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label={draft.mode === 'manual' ? 'Valor estimado' : 'Valor'}
            error={shown('value')}
            hint={
              draft.mode === 'manual'
                ? 'Estimativa: o valor real é informado ao lançar.'
                : 'Valor fixo, lançado sozinho na data.'
            }
          >
            {(props) => (
              <MoneyInput
                {...props}
                invalid={shown('value') !== undefined}
                value={draft.value}
                onChange={(event) => set({ value: event.target.value })}
              />
            )}
          </Field>
          <Field label="Situação">
            {(props) => (
              <Select
                {...props}
                invalid={false}
                options={STATES}
                value={draft.active ? 'ativo' : 'pausado'}
                onChange={(event) => set({ active: event.target.value === 'ativo' })}
              />
            )}
          </Field>
        </div>
        {effect === null ? null : (
          <EffectTable title={`Efeito em ${effectMonthLabel(today)}`} rows={effect} />
        )}
      </FormShell>
    </Modal>
  );
};

export const DeleteRecurringDialog = ({
  recurring,
  onConfirm,
  onClose,
}: {
  readonly recurring: Recurring;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}): React.ReactElement => (
  <Modal
    open
    narrow
    title="Excluir recorrente"
    tone="danger"
    onClose={onClose}
    footer={
      <>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="danger" onClick={onConfirm}>
          Excluir
        </Button>
      </>
    }
  >
    <p className="text-[0.8125rem] text-ink-2">
      Excluir “{recurring.name}”? Os previstos pendentes saem de Lançamentos; o que já foi
      lançado fica.
    </p>
  </Modal>
);
