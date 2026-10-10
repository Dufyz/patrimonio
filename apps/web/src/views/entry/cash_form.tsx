import { useMemo, useState } from 'react';

import { createCashMovement, previewTransaction } from '../../api/entry.js';
import type { SaveReceipt } from '../../api/entry.js';
import { Money } from '../../components/number.js';
import { Label } from '../../components/primitives.js';
import {
  buildCashBody,
  buildCashPreviewBody,
  effectRows,
  fieldOfApiMessage,
  operationTotal,
  TOTAL_LABEL,
} from '../../lib/entry.js';
import type {
  CashKind,
  EntryField,
  EntryReference,
  FieldErrors,
} from '../../lib/entry.js';
import { EffectPanel } from './effect_table.js';
import { Field, Input, Select, useVisibleErrors } from './fields.js';
import { FormShell } from './form_shell.js';
import { previewValue, usePreview, useSave } from './hooks.js';

/**
 * T-10 · Aporte e resgate (prancha 13C).
 *
 * O caixa vale um real por real, então o preview é o do lançamento comum, com a
 * quantidade igual ao valor.
 */

export type CashSeed = {
  readonly portfolioId: string | null;
  readonly institutionId: string | null;
  readonly date: string;
};

export const CashFormView = ({
  kind,
  reference,
  seed,
  onSaved,
  onCancel,
}: {
  readonly kind: CashKind;
  readonly reference: EntryReference;
  readonly seed: CashSeed;
  readonly onSaved: (
    receipt: SaveReceipt,
    again: boolean,
    institutionId: string | null,
  ) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const [portfolioId, setPortfolioId] = useState(seed.portfolioId);
  const [institutionId, setInstitutionId] = useState(seed.institutionId);
  const [date, setDate] = useState(seed.date);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const form = useMemo(
    () => ({
      portfolioId,
      institutionId,
      date,
      amount,
      note,
    }),
    [portfolioId, institutionId, date, amount, note],
  );

  const built = useMemo(() => buildCashBody(kind, form), [kind, form]);
  const previewBody = useMemo(() => buildCashPreviewBody(kind, form), [kind, form]);
  const body = previewBody !== null && previewBody.ok ? previewBody.body : null;

  const preview = usePreview(body === null ? null : JSON.stringify(body), (signal) => {
    if (body === null) throw new Error('sem corpo');
    return previewTransaction(body, signal);
  });
  const save = useSave();

  const apiMessage = preview.status === 'error' ? preview.message : (save.error ?? null);
  const apiField = apiMessage === null ? null : fieldOfApiMessage(apiMessage);
  const fromApi: FieldErrors =
    apiMessage !== null && apiField !== null ? { [apiField]: apiMessage } : {};

  const errors: FieldErrors = built.ok ? {} : built.errors;
  const visible = useVisibleErrors(errors, fromApi);
  const touch = (field: EntryField) => () => visible.touch(field);

  const submit = async (again: boolean): Promise<void> => {
    visible.attempt();
    if (!built.ok) return;

    const receipt = await save.run((key) => createCashMovement(built.body, key));
    if (receipt === null) return;

    onSaved(receipt, again, institutionId);
    if (again) setAmount('');
  };

  const value = previewValue(preview);

  return (
    <FormShell
      pending={save.pending}
      onSave={() => void submit(false)}
      onSaveAgain={() => void submit(true)}
      onCancel={onCancel}
      error={save.error !== null && apiField === null ? save.error : null}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Carteira" error={visible.show('portfolio')}>
          {(control) => (
            <Select
              {...control}
              invalid={control['aria-invalid']}
              options={reference.portfolios}
              placeholder="Escolha"
              value={portfolioId ?? ''}
              onBlur={touch('portfolio')}
              onChange={(event) => setPortfolioId(event.target.value || null)}
            />
          )}
        </Field>
        <Field label="Instituição" error={visible.show('institution')}>
          {(control) => (
            <Select
              {...control}
              invalid={control['aria-invalid']}
              options={reference.institutions}
              placeholder="Escolha"
              value={institutionId ?? ''}
              onBlur={touch('institution')}
              onChange={(event) => setInstitutionId(event.target.value || null)}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Data" error={visible.show('date')}>
          {(control) => (
            <Input
              {...control}
              type="date"
              invalid={control['aria-invalid']}
              value={date}
              onBlur={touch('date')}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </Field>
        <Field label="Valor" error={visible.show('amount')}>
          {(control) => (
            <Input
              {...control}
              numeric
              autoFocus
              inputMode="decimal"
              invalid={control['aria-invalid']}
              value={amount}
              onBlur={touch('amount')}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>
      </div>

      <Field label="Observação">
        {(control) => (
          <Input
            {...control}
            invalid={false}
            placeholder="opcional"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>

      <div className="flex items-baseline justify-between border-t border-line pt-3">
        <Label>{TOTAL_LABEL[kind]}</Label>
        <span className="text-lg font-semibold">
          {value === null ? (
            <span className="text-ink-3">—</span>
          ) : (
            <Money value={operationTotal(value)} />
          )}
        </span>
      </div>

      <EffectPanel
        state={preview}
        rows={(result) => effectRows(kind, result)}
        idle="Informe a carteira, a instituição e o valor para ver o efeito no caixa."
      />
    </FormShell>
  );
};
