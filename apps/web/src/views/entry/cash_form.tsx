import { useMemo, useState } from 'react';

import { createCashMovement, previewTransaction } from '../../api/entry.js';
import type { SaveReceipt } from '../../api/entry.js';
import { Money } from '../../components/number.js';
import { Label, Segmented } from '../../components/primitives.js';
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
import { Callout, Field, Input, Select, useVisibleErrors } from './fields.js';
import { FormShell } from './form_shell.js';
import { previewValue, usePreview, useSave } from './hooks.js';

/**
 * T-10 · Aporte e resgate (prancha 13C).
 *
 * O caixa vale um real por real, então o preview é o do lançamento comum, com a
 * quantidade igual ao valor. "De outra carteira" não é aporte: é dinheiro que
 * muda de carteira, o patrimônio total não se mexe, e por isso o formulário
 * avisa em vez de mostrar um efeito que não existe.
 *
 * Resgate só sai para fora: mover dinheiro entre carteiras é pedido pelo aporte
 * da carteira de destino, uma vez só, para não haver duas formas de fazer a mesma
 * coisa.
 */

export type CashSeed = {
  readonly portfolioId: string | null;
  readonly institutionId: string | null;
  readonly date: string;
};

const SOURCES = [
  { value: 'external', label: 'De fora do app' },
  { value: 'other_portfolio', label: 'De outra carteira' },
] as const;

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
  const [source, setSource] = useState<'external' | 'other_portfolio'>('external');
  const [fromPortfolioId, setFromPortfolioId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // O resgate não tem origem: a escolha só existe para o aporte.
  const effectiveSource = kind === 'deposit' ? source : 'external';

  const form = useMemo(
    () => ({
      portfolioId,
      institutionId,
      date,
      amount,
      source: effectiveSource,
      fromPortfolioId,
      note,
    }),
    [portfolioId, institutionId, date, amount, effectiveSource, fromPortfolioId, note],
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
  const otherPortfolios = reference.portfolios.filter(
    (portfolio) => portfolio.id !== portfolioId,
  );

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

      {kind === 'deposit' ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] text-ink-2">Origem do dinheiro</span>
          <Segmented
            label="Origem do dinheiro"
            options={SOURCES}
            value={source}
            onChange={setSource}
          />
        </div>
      ) : null}

      {effectiveSource === 'other_portfolio' ? (
        <Field label="Carteira de origem" error={visible.show('fromPortfolio')}>
          {(control) => (
            <Select
              {...control}
              invalid={control['aria-invalid']}
              options={otherPortfolios}
              placeholder="Escolha"
              value={fromPortfolioId ?? ''}
              onBlur={touch('fromPortfolio')}
              onChange={(event) => setFromPortfolioId(event.target.value || null)}
            />
          )}
        </Field>
      ) : null}

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

      {effectiveSource === 'other_portfolio' ? (
        <Callout tone="info">
          O dinheiro sai de uma carteira e entra na outra: o patrimônio total não muda e
          nada conta como aporte novo.
        </Callout>
      ) : (
        <>
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

          {kind === 'deposit' ? (
            <Callout tone="info">
              “De outra carteira” vira uma transferência: não conta como aporte novo no
              patrimônio.
            </Callout>
          ) : null}
        </>
      )}
    </FormShell>
  );
};
