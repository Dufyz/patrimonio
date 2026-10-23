import { useMemo, useState } from 'react';

import { createTransaction, previewTransaction } from '../../api/entry.js';
import type { SaveReceipt } from '../../api/entry.js';
import { Money } from '../../components/number.js';
import {
  buildTradeBody,
  effectRows,
  fieldOfApiMessage,
  operationTotal,
  TOTAL_LABEL,
} from '../../lib/entry.js';
import type {
  EntryField,
  EntryReference,
  FieldErrors,
  TradeKind,
} from '../../lib/entry.js';
import type { AssetSearch, PickedAsset } from './asset_picker.js';
import { AssetPicker } from './asset_picker.js';
import { EffectPanel } from './effect_table.js';
import {
  Field,
  Input,
  MoneyInput,
  Select,
  useVisibleErrors,
  FieldLabel,
} from './fields.js';
import { FormShell } from './form_shell.js';
import { BackButton } from './wizard.js';
import type { EntryWizard } from './wizard.js';
import { InstitutionPicker } from './institution_picker.js';
import { previewValue, useSave, usePreview } from './hooks.js';

/**
 * T-10 · Compra e venda (pranchas 13A e 17A).
 *
 * O formulário digita; o efeito vem da `api`. Cada mudança válida pede o
 * preview de `POST /transactions/preview` — o mesmo plano que o salvamento roda
 * — e a tabela mostra quantidade, preço médio, custo e peso antes → depois. Na
 * venda, o resultado realizado vem junto.
 *
 * Venda acima da posição é recusada pela própria `api`, e a recusa aparece no
 * campo da quantidade na hora, ainda no preview: ninguém descobre isso depois
 * de apertar Salvar.
 */

export type TradeSeed = {
  readonly asset?: PickedAsset | null;
  readonly portfolioId: string | null;
  readonly institutionId: string | null;
  readonly date: string;
  readonly quantity?: string;
  readonly price?: string;
  readonly fees?: string;
};

export const TradeFormView = ({
  kind,
  reference,
  seed,
  search,
  onSaved,
  onCancel,
  wizard,
}: {
  readonly kind: TradeKind;
  readonly reference: EntryReference;
  readonly seed: TradeSeed;
  readonly search?: AssetSearch;
  /** `again`: a pessoa pediu "Salvar e novo", e o modal continua aberto. */
  readonly onSaved: (
    receipt: SaveReceipt,
    again: boolean,
    institutionId: string | null,
  ) => void;
  readonly onCancel: () => void;
  /** No assistente do lançamento: o resumo, o Voltar e o "salvar e novo". */
  readonly wizard?: EntryWizard | undefined;
}): React.ReactElement => {
  const [asset, setAsset] = useState<PickedAsset | null>(seed.asset ?? null);
  const [date, setDate] = useState(seed.date);
  const [settlement, setSettlement] = useState('');
  const [quantity, setQuantity] = useState(seed.quantity ?? '');
  const [price, setPrice] = useState(seed.price ?? '');
  const [fees, setFees] = useState(seed.fees ?? '');
  const [portfolioId, setPortfolioId] = useState(seed.portfolioId);
  const [institutionId, setInstitutionId] = useState(seed.institutionId);
  const [generation, setGeneration] = useState(0);

  const built = useMemo(
    () =>
      buildTradeBody(kind, {
        assetId: asset?.id ?? null,
        newAsset: asset?.instrument ?? null,
        date,
        settlement,
        quantity,
        price,
        fees,
        portfolioId,
        institutionId,
      }),
    [kind, asset, date, settlement, quantity, price, fees, portfolioId, institutionId],
  );

  const body = built.ok ? built.body : null;
  const preview = usePreview(body === null ? null : JSON.stringify(body), (signal) => {
    if (body === null) throw new Error('sem corpo');
    return previewTransaction(body, signal);
  });
  const save = useSave();

  // O que a `api` recusou e tem campo próprio — a venda acima da posição, a
  // liquidação anterior à operação — aparece nesse campo, e não solto no rodapé.
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

    const receipt = await save.run((key) => createTransaction(built.body, key));
    if (receipt === null) return;

    onSaved(receipt, again, institutionId);

    if (again) {
      // A próxima compra costuma ser da mesma corretora, carteira e dia.
      if (wizard === undefined) setAsset(null);
      setQuantity('');
      setPrice('');
      setFees('');
      setGeneration((current) => current + 1);
      wizard?.onAgain();
    }
  };

  const value = previewValue(preview);
  const assetLabel = asset?.label;
  const panelMapped = preview.status === 'error' && apiField !== null;

  return (
    <FormShell
      {...(wizard === undefined
        ? {}
        : {
            summary: wizard.summary,
            secondary: <BackButton onBack={wizard.onBack} />,
            showCancel: false,
            saveLabel: 'Cadastrar',
          })}
      pending={save.pending}
      canSave={!save.pending}
      onSave={() => void submit(false)}
      onSaveAgain={() => void submit(true)}
      onCancel={onCancel}
      error={save.error !== null && apiField === null ? save.error : null}
    >
      {wizard !== undefined ? null : (
        <Field label="Ativo" error={visible.show('asset')}>
          {(control) => (
            <AssetPicker
              key={generation}
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
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Data da operação" error={visible.show('date')}>
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
        <Field
          label="Liquidação"
          error={visible.show('settlement')}
          hint="Em branco, a liquidação é calculada pelo tipo do ativo."
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              invalid={control['aria-invalid']}
              value={settlement}
              onBlur={touch('settlement')}
              onChange={(event) => setSettlement(event.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Quantidade" error={visible.show('quantity')}>
          {(control) => (
            <Input
              {...control}
              numeric
              inputMode="decimal"
              invalid={control['aria-invalid']}
              value={quantity}
              onBlur={touch('quantity')}
              onChange={(event) => setQuantity(event.target.value)}
            />
          )}
        </Field>
        <Field label="Preço unitário" error={visible.show('price')}>
          {(control) => (
            <MoneyInput
              maxDecimals={8}
              {...control}
              numeric
              inputMode="decimal"
              invalid={control['aria-invalid']}
              value={price}
              onBlur={touch('price')}
              onChange={(event) => setPrice(event.target.value)}
            />
          )}
        </Field>
        <Field
          label="Taxas"
          error={visible.show('fees')}
          hint="Em branco, vale a regra da instituição."
        >
          {(control) => (
            <MoneyInput
              {...control}
              numeric
              inputMode="decimal"
              invalid={control['aria-invalid']}
              value={fees}
              onBlur={touch('fees')}
              onChange={(event) => setFees(event.target.value)}
            />
          )}
        </Field>
      </div>

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

      <div className="flex items-baseline justify-between border-t border-line pt-3">
        <FieldLabel>{TOTAL_LABEL[kind]}</FieldLabel>
        <span className="text-lg font-semibold">
          {value === null ? (
            <span className="text-ink-3">—</span>
          ) : (
            <Money value={operationTotal(value)} />
          )}
        </span>
      </div>

      <EffectPanel
        state={panelMapped ? { status: 'idle' } : preview}
        rows={(preview_) =>
          effectRows(kind, preview_, assetLabel === undefined ? {} : { assetLabel })
        }
        idle={
          panelMapped
            ? 'Corrija o campo destacado para ver o efeito.'
            : 'Escolha o ativo e preencha quantidade e preço para ver o efeito antes de salvar.'
        }
      />
    </FormShell>
  );
};
