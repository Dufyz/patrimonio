import type { TransactionResource } from '@patrimonio/contracts';
import { useEffect, useMemo, useState } from 'react';

import { fetchTransaction, previewUpdate, updateTransaction } from '../../api/entry.js';
import type { SaveReceipt } from '../../api/entry.js';
import { deleteTransaction } from '../../api/transactions.js';
import type { DeletionReceipt } from '../../api/transactions.js';
import { ConfirmDialog } from '../../components/overlay.js';
import { Button } from '../../components/primitives.js';
import { TRANSACTION_KIND_LABELS } from '../../lib/asset_page.js';
import {
  buildUpdateBody,
  editFormOf,
  effectRows,
  fieldOfApiMessage,
  isEditable,
} from '../../lib/entry.js';
import type {
  EditForm,
  EffectKind,
  EntryField,
  EntryReference,
  FieldErrors,
} from '../../lib/entry.js';
import { formatShortDate } from '../../lib/positions.js';
import { EffectPanel } from './effect_table.js';
import { Callout, Field, Input, Select, useVisibleErrors } from './fields.js';
import { FormShell } from './form_shell.js';
import { InstitutionPicker } from './institution_picker.js';
import { usePreview, useSave } from './hooks.js';

/**
 * T-10 · Editar lançamento (prancha 17B).
 *
 * Três coisas distinguem a edição do lançamento novo:
 *
 * - **o que mudou fica marcado**, com o valor de antes ao lado do campo — em
 *   um formulário de dez campos, achar o que se mexeu é o trabalho que a tela
 *   deve fazer;
 * - **editar recalcula o que veio depois**: o preço médio de tudo a partir da
 *   data mais antiga entre a original e a nova muda. O aviso diz a partir de
 *   quando, em vez de uma frase genérica;
 * - **Excluir** fica à esquerda e em vermelho, longe de Salvar, e passa por
 *   confirmação que nomeia o lançamento. A exclusão tem desfazer.
 */

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly transaction: TransactionResource };

const effectKindOf = (transaction: TransactionResource): EffectKind =>
  transaction.kind === 'buy' ||
  transaction.kind === 'sell' ||
  transaction.kind === 'deposit' ||
  transaction.kind === 'withdrawal'
    ? transaction.kind
    : 'payout';

const isCash = (transaction: TransactionResource): boolean =>
  transaction.kind === 'deposit' || transaction.kind === 'withdrawal';

/** O lançamento, carregado; o formulário só existe quando ele chegou. */
export const EditEntry = ({
  transactionId,
  reference,
  assetLabel,
  onSaved,
  onDeleted,
  onCancel,
}: {
  readonly transactionId: string;
  readonly reference: EntryReference;
  readonly assetLabel?: string | undefined;
  readonly onSaved: (receipt: SaveReceipt) => void;
  readonly onDeleted: (receipt: DeletionReceipt) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setLoaded({ status: 'loading' });

    fetchTransaction(transactionId, controller.signal)
      .then((transaction) => {
        if (!controller.signal.aborted) setLoaded({ status: 'ready', transaction });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'A api não respondeu',
        });
      });

    return () => controller.abort();
  }, [transactionId]);

  if (loaded.status === 'loading') {
    return (
      <p className="py-6 text-center text-sm text-ink-3">Carregando o lançamento…</p>
    );
  }

  if (loaded.status === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <Callout tone="error">{loaded.message}</Callout>
        <div className="flex justify-end">
          <Button onClick={onCancel}>Fechar</Button>
        </div>
      </div>
    );
  }

  if (!isEditable(loaded.transaction)) {
    return (
      <div className="flex flex-col gap-3">
        <Callout tone="info">
          Eventos corporativos não são editados aqui.
        </Callout>
        <div className="flex justify-end">
          <Button onClick={onCancel}>Fechar</Button>
        </div>
      </div>
    );
  }

  return (
    <EditFormView
      transaction={loaded.transaction}
      reference={reference}
      assetLabel={assetLabel}
      onSaved={onSaved}
      onDeleted={onDeleted}
      onCancel={onCancel}
    />
  );
};

const fullDate = (iso: string): string => iso.split('-').reverse().join('/');

/** `31,4` → `31,40`: o valor de antes aparece como dinheiro, e não como o campo o guarda. */
const twoDecimals = (value: string): string => {
  if (value === '') return value;
  const [integer = '', fraction = ''] = value.split(',');
  return `${integer},${fraction.padEnd(2, '0')}`;
};

const TrashIcon = (): React.ReactElement => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path
      d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8h6l.5-8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** "antes: 31,04" sob o campo que mudou. */
const before = (changed: boolean, was: string): string | undefined =>
  changed ? `antes: ${was === '' ? '—' : was}` : undefined;

export const EditFormView = ({
  transaction,
  reference,
  assetLabel,
  onSaved,
  onDeleted,
  onCancel,
}: {
  readonly transaction: TransactionResource;
  readonly reference: EntryReference;
  readonly assetLabel?: string | undefined;
  readonly onSaved: (receipt: SaveReceipt) => void;
  readonly onDeleted: (receipt: DeletionReceipt) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const original = useMemo(() => editFormOf(transaction), [transaction]);
  const [form, setForm] = useState<EditForm>(original);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const built = useMemo(
    () => buildUpdateBody(transaction, form, transaction.id),
    [transaction, form],
  );

  const hasChanges = built.ok && built.changed.length > 0;
  const body = built.ok && built.changed.length > 0 ? built.body : null;

  const preview = usePreview(body === null ? null : JSON.stringify(body), (signal) => {
    if (body === null) throw new Error('sem corpo');
    return previewUpdate(transaction.id, body, signal);
  });
  const save = useSave();

  const apiMessage = preview.status === 'error' ? preview.message : (save.error ?? null);
  const apiField = apiMessage === null ? null : fieldOfApiMessage(apiMessage);
  const fromApi: FieldErrors =
    apiMessage !== null && apiField !== null ? { [apiField]: apiMessage } : {};

  const errors: FieldErrors = built.ok ? {} : built.errors;
  const visible = useVisibleErrors(errors, fromApi);
  const touch = (field: EntryField) => () => visible.touch(field);

  const changed = (field: EntryField): boolean =>
    built.ok && built.changed.includes(field);

  const submit = async (): Promise<void> => {
    visible.attempt();
    if (!built.ok || built.changed.length === 0) return;

    const receipt = await save.run((key) =>
      updateTransaction(transaction.id, built.body, key),
    );
    if (receipt !== null) onSaved(receipt);
  };

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const receipt = await deleteTransaction(transaction.id);
      setConfirmingDelete(false);
      onDeleted(receipt);
    } catch (cause) {
      setConfirmingDelete(false);
      setDeleteError(
        cause instanceof Error ? cause.message : 'Não foi possível excluir.',
      );
    } finally {
      setDeleting(false);
    }
  };

  const cash = isCash(transaction);
  const payout = transaction.kind === 'payout';
  const kindLabel = TRANSACTION_KIND_LABELS[transaction.kind];
  const subject = [kindLabel, assetLabel, formatShortDate(transaction.trade_date)]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');

  // Editar uma data para antes recalcula desde a nova; para depois, desde a original.
  const since =
    form.date !== '' && form.date < transaction.trade_date
      ? form.date
      : transaction.trade_date;

  const panelMapped = preview.status === 'error' && apiField !== null;

  return (
    <>
      <FormShell
        pending={save.pending}
        canSave={hasChanges}
        saveLabel="Salvar alterações"
        onSave={() => void submit()}
        onCancel={onCancel}
        error={
          save.error !== null && apiField === null
            ? save.error
            : (deleteError ?? undefined)
        }
        destructive={
          <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
            <TrashIcon />
            Excluir
          </Button>
        }
      >
        <Callout tone="warning">
          Alterar este lançamento recalcula preço médio, resultado e rentabilidade a
          partir de {fullDate(since)}.
        </Callout>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Data da operação"
            error={visible.show('date')}
            hint={before(changed('date'), formatShortDate(transaction.trade_date))}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                invalid={control['aria-invalid']}
                changed={changed('date')}
                value={form.date}
                onBlur={touch('date')}
                onChange={(event) => set('date', event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Liquidação"
            error={visible.show('settlement')}
            hint={before(
              changed('settlement'),
              formatShortDate(transaction.settlement_date),
            )}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                invalid={control['aria-invalid']}
                changed={changed('settlement')}
                value={form.settlement}
                onBlur={touch('settlement')}
                onChange={(event) => set('settlement', event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className={`grid gap-3 ${cash ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
          <Field
            label={cash ? 'Valor' : 'Quantidade'}
            error={visible.show('quantity')}
            hint={before(changed('quantity'), original.quantity)}
          >
            {(control) => (
              <Input
                {...control}
                numeric
                inputMode="decimal"
                invalid={control['aria-invalid']}
                changed={changed('quantity')}
                value={form.quantity}
                onBlur={touch('quantity')}
                onChange={(event) => set('quantity', event.target.value)}
              />
            )}
          </Field>
          {cash ? null : (
            <Field
              label={payout ? 'Valor por ação' : 'Preço unitário'}
              error={visible.show('price')}
              hint={before(changed('price'), twoDecimals(original.price))}
            >
              {(control) => (
                <Input
                  {...control}
                  numeric
                  inputMode="decimal"
                  invalid={control['aria-invalid']}
                  changed={changed('price')}
                  value={form.price}
                  onBlur={touch('price')}
                  onChange={(event) => set('price', event.target.value)}
                />
              )}
            </Field>
          )}
          <Field
            label="Taxas"
            error={visible.show('fees')}
            hint={before(changed('fees'), twoDecimals(original.fees))}
          >
            {(control) => (
              <Input
                {...control}
                numeric
                inputMode="decimal"
                invalid={control['aria-invalid']}
                changed={changed('fees')}
                value={form.fees}
                onBlur={touch('fees')}
                onChange={(event) => set('fees', event.target.value)}
              />
            )}
          </Field>
        </div>

        {payout ? (
          <Field
            label="IR retido"
            error={visible.show('tax')}
            hint={before(changed('tax'), twoDecimals(original.tax))}
          >
            {(control) => (
              <Input
                {...control}
                numeric
                inputMode="decimal"
                invalid={control['aria-invalid']}
                changed={changed('tax')}
                value={form.tax}
                onBlur={touch('tax')}
                onChange={(event) => set('tax', event.target.value)}
              />
            )}
          </Field>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Carteira"
            error={visible.show('portfolio')}
            hint={before(
              changed('portfolio'),
              reference.portfolios.find((item) => item.id === transaction.portfolio_id)
                ?.name ?? '',
            )}
          >
            {(control) => (
              <Select
                {...control}
                invalid={control['aria-invalid']}
                changed={changed('portfolio')}
                options={reference.portfolios}
                value={form.portfolioId}
                onBlur={touch('portfolio')}
                onChange={(event) => set('portfolioId', event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Instituição"
            error={visible.show('institution')}
            hint={before(
              changed('institution'),
              reference.institutions.find(
                (item) => item.id === transaction.institution_id,
              )?.name ?? '',
            )}
          >
            {(control) => (
              <InstitutionPicker
                control={control}
                invalid={control['aria-invalid']}
                changed={changed('institution')}
                options={reference.institutions}
                value={form.institutionId === '' ? null : form.institutionId}
                onBlur={touch('institution')}
                onChange={(id) => set('institutionId', id ?? '')}
              />
            )}
          </Field>
        </div>

        <Field label="Observação" hint={before(changed('note'), original.note)}>
          {(control) => (
            <Input
              {...control}
              invalid={false}
              changed={changed('note')}
              placeholder="opcional"
              value={form.note}
              onChange={(event) => set('note', event.target.value)}
            />
          )}
        </Field>

        {hasChanges ? (
          <EffectPanel
            title="O que muda"
            state={panelMapped ? { status: 'idle' } : preview}
            rows={(result) =>
              effectRows(
                effectKindOf(transaction),
                result,
                assetLabel === undefined ? {} : { assetLabel },
              )
            }
            idle={
              panelMapped
                ? 'Corrija o campo destacado para ver o efeito.'
                : 'Corrija os campos destacados para ver o efeito.'
            }
          />
        ) : (
          <p className="text-[0.8125rem] text-ink-3">
            Altere um campo para ver o efeito da edição antes de salvar.
          </p>
        )}

        <p className="text-[0.75rem] text-ink-3">
          Criado em {fullDate(transaction.created_at.slice(0, 10))}
        </p>
      </FormShell>

      <ConfirmDialog
        open={confirmingDelete}
        title="Excluir lançamento"
        subject={subject}
        consequence={`O preço médio e as posições são recalculados a partir de ${formatShortDate(transaction.trade_date)}. Dá para desfazer logo depois.`}
        onConfirm={() => {
          if (!deleting) void remove();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
};
