import { useMemo, useState } from 'react';

import { previewTransfer, transferPosition } from '../../api/entry.js';
import type { SaveReceipt } from '../../api/entry.js';
import { buildTransferBody, fieldOfApiMessage, transferRows } from '../../lib/entry.js';
import type { EntryField, EntryReference, FieldErrors } from '../../lib/entry.js';
import type { AssetSearch, PickedAsset } from './asset_picker.js';
import { AssetPicker } from './asset_picker.js';
import { EffectPanel } from './effect_table.js';
import { Callout, Field, Input, Select, useVisibleErrors } from './fields.js';
import { FormShell } from './form_shell.js';
import { usePreview, useSave } from './hooks.js';

/**
 * T-10 · Mover posição entre carteiras (prancha 15C).
 *
 * Reclassificação interna, não venda: o preço médio acompanha a posição, não há
 * resultado realizado nem imposto, e o patrimônio total não muda. O preview
 * mostra as duas pontas e a linha do total para que isso seja visto, não
 * prometido.
 *
 * "Tudo" move o que houver na data e dispensa a quantidade — digitar uma
 * quantidade que a posição já não tem mais é o erro que o botão evita.
 */

export type TransferSeed = {
  readonly asset?: PickedAsset | null;
  readonly fromPortfolioId: string | null;
  readonly institutionId: string | null;
  readonly date: string;
};

export const TransferFormView = ({
  reference,
  seed,
  search,
  onSaved,
  onCancel,
}: {
  readonly reference: EntryReference;
  readonly seed: TransferSeed;
  readonly search?: AssetSearch;
  readonly onSaved: (
    receipt: SaveReceipt,
    again: boolean,
    institutionId: string | null,
  ) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const [asset, setAsset] = useState<PickedAsset | null>(seed.asset ?? null);
  const [fromPortfolioId, setFromPortfolioId] = useState(seed.fromPortfolioId);
  const [toPortfolioId, setToPortfolioId] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState(seed.institutionId);
  const [date, setDate] = useState(seed.date);
  const [quantity, setQuantity] = useState('');
  const [all, setAll] = useState(false);
  const [note, setNote] = useState('');

  const built = useMemo(
    () =>
      buildTransferBody({
        assetId: asset?.id ?? null,
        fromPortfolioId,
        toPortfolioId,
        institutionId,
        date,
        quantity,
        all,
        note,
      }),
    [asset, fromPortfolioId, toPortfolioId, institutionId, date, quantity, all, note],
  );

  const body = built.ok ? built.body : null;
  const preview = usePreview(body === null ? null : JSON.stringify(body), (signal) => {
    if (body === null) throw new Error('sem corpo');
    return previewTransfer(body, signal);
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

    const receipt = await save.run((key) => transferPosition(built.body, key));
    if (receipt !== null) onSaved(receipt, false, institutionId);
  };

  const nameOf = (id: string | null): string =>
    reference.portfolios.find((portfolio) => portfolio.id === id)?.name ?? 'Carteira';
  const panelMapped = preview.status === 'error' && apiField !== null;

  return (
    <FormShell
      pending={save.pending}
      onSave={() => void submit()}
      onCancel={onCancel}
      error={save.error !== null && apiField === null ? save.error : null}
    >
      <Field label="Ativo" error={visible.show('asset')}>
        {(control) => (
          <AssetPicker
            control={control}
            invalid={control['aria-invalid']}
            value={asset}
            onChange={setAsset}
            onBlur={touch('asset')}
            autoFocus={asset === null}
            {...(search === undefined ? {} : { search })}
          />
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="De" error={visible.show('fromPortfolio')}>
          {(control) => (
            <Select
              {...control}
              invalid={control['aria-invalid']}
              options={reference.portfolios}
              placeholder="Escolha"
              value={fromPortfolioId ?? ''}
              onBlur={touch('fromPortfolio')}
              onChange={(event) => setFromPortfolioId(event.target.value || null)}
            />
          )}
        </Field>
        <Field label="Para" error={visible.show('toPortfolio')}>
          {(control) => (
            <Select
              {...control}
              invalid={control['aria-invalid']}
              options={reference.portfolios.filter(
                (portfolio) => portfolio.id !== fromPortfolioId,
              )}
              placeholder="Escolha"
              value={toPortfolioId ?? ''}
              onBlur={touch('toPortfolio')}
              onChange={(event) => setToPortfolioId(event.target.value || null)}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Quantidade"
          error={visible.show('quantity')}
          hint={all ? 'Move toda a posição que houver na data.' : undefined}
        >
          {(control) => (
            <div className="flex gap-2">
              <Input
                {...control}
                numeric
                inputMode="decimal"
                disabled={all}
                invalid={control['aria-invalid']}
                value={all ? '' : quantity}
                placeholder={all ? 'tudo' : ''}
                onBlur={touch('quantity')}
                onChange={(event) => setQuantity(event.target.value)}
              />
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={all}
                  onChange={(event) => setAll(event.target.checked)}
                />
                Tudo
              </label>
            </div>
          )}
        </Field>
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
      </div>

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

      <Callout tone="info">
        O preço médio é mantido nas duas carteiras. Mover não é vender: não gera resultado
        realizado nem imposto, e o patrimônio total não muda.
      </Callout>

      <EffectPanel
        state={panelMapped ? { status: 'idle' } : preview}
        rows={(result) =>
          transferRows(result, {
            origin: nameOf(fromPortfolioId),
            destination: nameOf(toPortfolioId),
          })
        }
        title="Efeito nas carteiras"
        idle={
          panelMapped
            ? 'Corrija o campo destacado para ver o efeito.'
            : 'Escolha o ativo, as duas carteiras e a quantidade para ver o efeito.'
        }
      />
    </FormShell>
  );
};
