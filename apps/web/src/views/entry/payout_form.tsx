import { PAYOUT_KINDS } from '@patrimonio/domain';
import type { PayoutKind } from '@patrimonio/domain';
import { useMemo, useState } from 'react';

import { createPayout, previewPayout } from '../../api/entry.js';
import type { SaveReceipt } from '../../api/entry.js';
import { Money, Quantity } from '../../components/number.js';
import { Segmented } from '../../components/primitives.js';
import { PAYOUT_KIND_LABELS } from '../../lib/asset_page.js';
import { buildPayoutBody, effectRows, fieldOfApiMessage } from '../../lib/entry.js';
import type {
  EntryField,
  EntryReference,
  FieldErrors,
  PayoutEntryMode,
} from '../../lib/entry.js';
import { formatShortDate } from '../../lib/positions.js';
import type { AssetSearch, PickedAsset } from './asset_picker.js';
import { AssetPicker } from './asset_picker.js';
import { EffectPanel } from './effect_table.js';
import { Callout, Field, Input, Select, useVisibleErrors } from './fields.js';
import { FormShell } from './form_shell.js';
import { InstitutionPicker } from './institution_picker.js';
import { previewValue, usePreview, useSave } from './hooks.js';

/**
 * T-10 · Provento (prancha 13B).
 *
 * A quantidade que recebe **não é digitada**: ela é a posição na data-com,
 * calculada pelos lançamentos, e o formulário a mostra assim que o preview
 * responde. Digitar esse número é a forma mais fácil de o provento ficar errado
 * seis meses depois de uma compra esquecida — e por isso o campo é só leitura.
 *
 * O bruto, o IR retido e o líquido também vêm do preview, e o IR do JCP é o
 * percentual de implantação da `api`, não uma constante da tela.
 */

export type PayoutSeed = {
  readonly asset?: PickedAsset | null;
  readonly portfolioId: string | null;
  readonly institutionId: string | null;
  readonly date: string;
};

/** Os rótulos desta aba, como a prancha 13B os escreve. */
const PAYOUT_TABS: Readonly<Record<string, string>> = {
  interest: 'Juros/cupom',
};

const MODES: readonly { readonly value: PayoutEntryMode; readonly label: string }[] = [
  { value: 'per_share', label: 'Valor por ação' },
  { value: 'gross', label: 'Total bruto' },
];

export const PayoutFormView = ({
  reference,
  seed,
  search,
  onSaved,
  onCancel,
}: {
  readonly reference: EntryReference;
  readonly seed: PayoutSeed;
  readonly search?: AssetSearch;
  readonly onSaved: (
    receipt: SaveReceipt,
    again: boolean,
    institutionId: string | null,
  ) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const [asset, setAsset] = useState<PickedAsset | null>(seed.asset ?? null);
  const [payoutKind, setPayoutKind] = useState<PayoutKind>('dividend');
  const [recordDate, setRecordDate] = useState(seed.date);
  const [paymentDate, setPaymentDate] = useState(seed.date);
  const [mode, setMode] = useState<PayoutEntryMode>('per_share');
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('');
  const [portfolioId, setPortfolioId] = useState(seed.portfolioId);
  const [institutionId, setInstitutionId] = useState(seed.institutionId);
  const [received, setReceived] = useState(false);
  const [note, setNote] = useState('');

  const built = useMemo(
    () =>
      buildPayoutBody({
        assetId: asset?.id ?? null,
        payoutKind,
        recordDate,
        paymentDate,
        mode,
        amount,
        tax,
        portfolioId,
        institutionId,
        received,
        note,
      }),
    [
      asset,
      payoutKind,
      recordDate,
      paymentDate,
      mode,
      amount,
      tax,
      portfolioId,
      institutionId,
      received,
      note,
    ],
  );

  const body = built.ok ? built.body : null;
  const preview = usePreview(body === null ? null : JSON.stringify(body), (signal) => {
    if (body === null) throw new Error('sem corpo');
    return previewPayout(body, signal);
  });
  const save = useSave();

  const apiMessage = preview.status === 'error' ? preview.message : (save.error ?? null);
  const apiField = apiMessage === null ? null : fieldOfApiMessage(apiMessage);
  const fromApi: FieldErrors =
    apiMessage !== null && apiField !== null ? { [apiField]: apiMessage } : {};

  const errors: FieldErrors = built.ok ? {} : built.errors;
  const visible = useVisibleErrors(errors, fromApi);
  const touch = (field: EntryField) => () => visible.touch(field);

  const submit = async (): Promise<void> => {
    visible.attempt();
    if (!built.ok) return;

    const receipt = await save.run((key) => createPayout(built.body, key));
    if (receipt !== null) onSaved(receipt, false, institutionId);
  };

  const value = previewValue(preview);
  const amountField: EntryField = mode === 'per_share' ? 'perShare' : 'gross';
  const overdue = paymentDate !== '' && paymentDate < seed.date;

  return (
    <FormShell
      pending={save.pending}
      onSave={() => void submit()}
      onCancel={onCancel}
      error={save.error !== null && apiField === null ? save.error : null}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.8125rem] text-ink-2">Tipo de provento</span>
        <Segmented
          label="Tipo de provento"
          options={PAYOUT_KINDS.map((kind) => ({
            value: kind,
            label: PAYOUT_TABS[kind] ?? PAYOUT_KIND_LABELS[kind] ?? kind,
          }))}
          value={payoutKind}
          onChange={setPayoutKind}
        />
      </div>

      <Field label="Ativo" error={visible.show('asset')}>
        {(control) => (
          <AssetPicker
            control={control}
            invalid={control['aria-invalid']}
            portfolioId={portfolioId}
            value={asset}
            onChange={setAsset}
            onBlur={touch('asset')}
            autoFocus={asset === null}
            {...(search === undefined ? {} : { search })}
          />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Data com" error={visible.show('recordDate')}>
          {(control) => (
            <Input
              {...control}
              type="date"
              invalid={control['aria-invalid']}
              value={recordDate}
              onBlur={touch('recordDate')}
              onChange={(event) => setRecordDate(event.target.value)}
            />
          )}
        </Field>
        <Field label="Pagamento" error={visible.show('paymentDate')}>
          {(control) => (
            <Input
              {...control}
              type="date"
              invalid={control['aria-invalid']}
              value={paymentDate}
              onBlur={touch('paymentDate')}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Qtd na data-com" hint="calculada pelos lançamentos">
          {(control) => (
            <output
              id={control.id}
              aria-describedby={control['aria-describedby']}
              className="tabular flex h-control items-center justify-end rounded-control border border-line bg-panel-2 px-3 text-sm"
            >
              {value === null ? (
                <span className="text-ink-3">—</span>
              ) : (
                <Quantity value={value.quantity_at_record_date} />
              )}
            </output>
          )}
        </Field>
        <Field
          label={mode === 'per_share' ? 'Valor por ação' : 'Total bruto'}
          error={visible.show(amountField)}
        >
          {(control) => (
            <Input
              {...control}
              numeric
              inputMode="decimal"
              invalid={control['aria-invalid']}
              value={amount}
              onBlur={touch(amountField)}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </Field>
      </div>

      <Segmented
        label="Como o valor foi informado"
        options={MODES}
        value={mode}
        onChange={(next) => {
          setMode(next);
          setAmount('');
        }}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Bruto">
          {(control) => (
            <output
              id={control.id}
              className="tabular flex h-control items-center justify-end rounded-control border border-line bg-panel-2 px-3 text-sm"
            >
              {value === null ? (
                <span className="text-ink-3">—</span>
              ) : (
                <Money value={value.gross_amount} />
              )}
            </output>
          )}
        </Field>
        <Field
          label={payoutKind === 'jcp' ? 'IR retido' : 'IR retido (se houver)'}
          error={visible.show('tax')}
          hint={
            tax === ''
              ? `automático para ${PAYOUT_KIND_LABELS[payoutKind] ?? 'este tipo'}`
              : undefined
          }
        >
          {(control) => (
            <Input
              {...control}
              numeric
              inputMode="decimal"
              invalid={control['aria-invalid']}
              placeholder={value === null ? '' : formatPlaceholder(value.tax_withheld)}
              value={tax}
              onBlur={touch('tax')}
              onChange={(event) => setTax(event.target.value)}
            />
          )}
        </Field>
        <Field label="Líquido">
          {(control) => (
            <output
              id={control.id}
              className="tabular flex h-control items-center justify-end rounded-control border border-line bg-panel-2 px-3 text-sm font-semibold"
            >
              {value === null ? (
                <span className="text-ink-3">—</span>
              ) : (
                <Money value={value.net_amount} />
              )}
            </output>
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={received}
            onChange={(event) => setReceived(event.target.checked)}
          />
          Já recebido
        </label>
        <span className="text-[0.75rem] text-ink-3">
          {received
            ? 'entra como dinheiro na carteira agora'
            : paymentDate === ''
              ? 'fica como a receber'
              : `fica como a receber até ${formatShortDate(paymentDate)}`}
        </span>
      </div>

      {!received && overdue ? (
        <Callout tone="warning">
          O pagamento já passou. Marque “Já recebido” para o provento entrar como
          dinheiro; do contrário ele fica a receber até ser confirmado.
        </Callout>
      ) : null}

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
            <InstitutionPicker
              control={control}
              invalid={control['aria-invalid']}
              options={reference.institutions}
              value={institutionId}
              onBlur={touch('institution')}
              onChange={setInstitutionId}
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

      {received || preview.status === 'error' ? (
        <EffectPanel
          state={preview}
          rows={(result) => effectRows('payout', result.preview)}
          idle="Preencha o ativo, as datas e o valor para ver o efeito no caixa."
        />
      ) : (
        <Callout tone="info">
          Proventos futuros entram como “a receber” e aparecem em Próximos eventos. O
          caixa só muda quando o recebimento é confirmado.
        </Callout>
      )}
    </FormShell>
  );
};

/** O IR que a `api` vai reter, como dica no campo em branco: `16.96` → `16,96`. */
const formatPlaceholder = (value: string): string => value.replace('.', ',');
