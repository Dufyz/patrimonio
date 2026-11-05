import { useState } from 'react';

import { Modal } from '../../components/overlay.js';
import { FormShell } from '../../views/entry/form_shell.js';
import { Checkbox } from '../../components/ui/checkbox.js';
import { EffectTable } from './effect_table.js';
import { entryEffect, launchEffect } from '../domain/effects.js';
import { Segmented } from '../../components/primitives.js';
import { Callout, Field, Input, MoneyInput, Select } from '../../views/entry/fields.js';
import {
  FUTURE_DATE,
  FUTURE_HINT,
  allowedSources,
  canInstall,
  installmentSummary,
  paymentsOf,
  splitDifference,
  validateEntry,
} from '../domain/entry_ops.js';
import type { EntryDraft } from '../domain/entry_ops.js';
import type { FinanceData } from '../domain/types.js';
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

const KIND_OPTIONS = [
  { value: 'despesa', label: 'Despesa' },
  { value: 'receita', label: 'Receita' },
] as const;

export const EntryDialog = ({
  mode,
  data,
  initial,
  today,
  onSave,
  onClose,
  onCreateRecurring,
  launchId,
  onSaveAndNew,
}: {
  readonly mode: EntryDialogMode;
  readonly data: FinanceData;
  readonly initial: EntryDraft;
  readonly today: string;
  readonly onSave: (draft: EntryDraft) => void;
  readonly onClose: () => void;
  /** Para algo futuro, o modal oferece criar um recorrente. */
  readonly onCreateRecurring?: (() => void) | undefined;
  /** Ao lançar um previsto: qual é, para o efeito comparar com ele. */
  readonly launchId?: string | undefined;
  /** "Salvar e novo": grava sem fechar e limpa o formulário (⇧↵). Só em `new`. */
  readonly onSaveAndNew?: ((draft: EntryDraft) => void) | undefined;
}): React.ReactElement => {
  const [draft, setDraft] = useState<EntryDraft>(initial);
  const [attempted, setAttempted] = useState(false);

  const errors = validateEntry(data, draft, today, mode === 'new');
  const shown = (field: keyof typeof errors): string | undefined =>
    attempted ? errors[field] : undefined;
  const set = (patch: Partial<EntryDraft>): void => setDraft({ ...draft, ...patch });

  const locked = mode === 'launch';
  const diff = splitDifference(draft);
  const blocked = diff !== null && diff !== 0;
  const effect =
    mode === 'new'
      ? entryEffect(data, draft, today)
      : mode === 'launch' && launchId !== undefined
        ? launchEffect(data, launchId, draft, today)
        : null;
  const modelParts = mode === 'launch' && draft.split ? paymentsOf(draft) : [];

  const categories = data.categories
    .filter((category) => category.kind === draft.kind)
    .map((category) => ({ id: category.id, name: category.name }));
  const sources = allowedSources(data, draft.kind).map((s) => ({
    id: s.id,
    name: s.name,
  }));

  const save = (): void => {
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    onSave(draft);
  };

  const saveAndNew = (): void => {
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    onSaveAndNew?.(draft);
    setDraft({ ...initial, date: draft.date, kind: draft.kind });
    setAttempted(false);
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
    <Modal open guard narrow title={TITLES[mode]} subtitle="Finanças" onClose={onClose}>
      <FormShell
        pending={false}
        onSave={save}
        {...(mode === 'new' && onSaveAndNew !== undefined
          ? { onSaveAgain: saveAndNew }
          : {})}
        onCancel={onClose}
        saveLabel={mode === 'launch' ? 'Lançar' : 'Salvar'}
        canSave={!blocked}
      >
        {locked ? null : (
          <Segmented
            label="Tipo"
            options={KIND_OPTIONS}
            value={draft.kind}
            onChange={(kind) => {
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

        <Field label="Valor" error={shown('value')}>
          {(props) => (
            <MoneyInput
              {...props}
              autoFocus
              className="!h-12 !text-[1.375rem] font-semibold"
              invalid={shown('value') !== undefined}
              value={draft.value}
              onChange={(event) => onValue(event.target.value)}
            />
          )}
        </Field>

        <Field label="Descrição" error={shown('description')}>
          {(props) => (
            <Input
              {...props}
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
          <Field label="Data" error={shown('date')}>
            {(props) => (
              <Input
                {...props}
                type="date"
                {...(mode === 'new' ? {} : { max: today })}
                invalid={shown('date') !== undefined}
                value={draft.date}
                onChange={(event) => set({ date: event.target.value })}
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
                placeholder="Conta ou cartão"
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
                  onChange={(event) => {
                    const firstValue = event.target.value;
                    const total = parseMoneyInput(draft.value);
                    const first = parseMoneyInput(firstValue);
                    set(
                      total !== null && first !== null && total >= first
                        ? {
                            firstValue,
                            secondValue: ((total - first) / 100)
                              .toFixed(2)
                              .replace('.', ','),
                          }
                        : { firstValue },
                    );
                  }}
                />
              )}
            </Field>
          ) : null}
        </div>

        {draft.date > today ? (
          <p className="text-xs text-ink-3">
            {mode === 'new' ? FUTURE_HINT : FUTURE_DATE}
            {mode === 'new' && onCreateRecurring !== undefined ? (
              <>
                {' '}
                Se repete todo mês,{' '}
                <button
                  type="button"
                  className="cursor-pointer font-medium text-accent underline"
                  onClick={onCreateRecurring}
                >
                  crie um recorrente
                </button>
                .
              </>
            ) : null}
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

        {draft.split ? (
          <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3 text-[0.8125rem]">
            <span className="text-ink-2">Soma das origens</span>
            <strong className="tabular text-[1.125rem] font-semibold">
              {formatBRL(paymentsOf(draft).reduce((sum, part) => sum + part.cents, 0))}
            </strong>
          </div>
        ) : null}

        {draft.split ? (
          <Callout tone="info">
            A soma das origens tem que fechar com o valor. Ao preencher a primeira origem,
            a segunda recebe o que falta.
          </Callout>
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

        {modelParts.length === 0 ? null : (
          <div
            role="group"
            aria-label="Pagamento calculado pelo modelo"
            className="rounded-control border border-line"
          >
            <div className="tabular border-b border-line px-3 py-1.5 text-label tracking-[0.06em] text-ink-3 uppercase">
              Pagamento · calculado pelo modelo
            </div>
            <ul>
              {modelParts.map((part, index) => (
                <li
                  key={`${part.sourceId}-${index}`}
                  className="flex items-baseline justify-between gap-4 border-t border-line px-3 py-2 text-[0.8125rem] first:border-t-0"
                >
                  <span>
                    {data.accounts.find((a) => a.id === part.sourceId)?.name ??
                      part.sourceId}
                    <span className="ml-1.5 text-xs text-ink-3">
                      {index === 0 ? 'primeira origem' : 'o restante'}
                    </span>
                  </span>
                  <strong className="tabular font-semibold">
                    {formatBRL(part.cents)}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        {effect === null ? null : <EffectTable rows={effect} />}

        {mode === 'launch' ? (
          <Callout tone="info">
            Mudando o valor real, a primeira origem continua até o limite configurado e o
            restante ajusta na segunda. Dá para editar as duas partes à mão.
          </Callout>
        ) : null}

        {mode === 'new' && canInstall(data, draft) && Number(draft.installments) > 1 ? (
          <Callout tone="info">
            Compra parcelada vira uma despesa por mês, na fatura de cada parcela, até a
            última.
          </Callout>
        ) : null}
      </FormShell>
    </Modal>
  );
};
