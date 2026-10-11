import { useMemo, useState } from 'react';

import { applyCorporateEvent, previewCorporateEvent } from '../../api/entry.js';
import type { SaveReceipt } from '../../api/entry.js';
import { Segmented } from '../../components/primitives.js';
import { buildEventBody, EVENT_KINDS, eventRows } from '../../lib/entry.js';
import type { EntryField, EventKind, FieldErrors } from '../../lib/entry.js';
import type { AssetSearch, PickedAsset } from './asset_picker.js';
import { AssetPicker } from './asset_picker.js';
import { EffectPanel } from './effect_table.js';
import { Callout, Field, Input, useVisibleErrors } from './fields.js';
import { FormShell } from './form_shell.js';
import { usePreview, useSave } from './hooks.js';

/**
 * Evento corporativo lançado à mão.
 *
 * Não há provedor que anuncie desdobramento, grupamento ou bonificação: quem
 * lança é a pessoa, com a data-com e o fator. O efeito aparece antes de salvar —
 * quantidade e preço médio mudam, o custo total não — e confirmar aplica o
 * evento em toda carteira que tinha posição na data-com, recalculando dali.
 */

export type EventSeed = {
  readonly asset: PickedAsset | null;
  readonly date: string;
};

export const EventFormView = ({
  seed,
  search,
  onSaved,
  onCancel,
}: {
  readonly seed: EventSeed;
  readonly search?: AssetSearch;
  readonly onSaved: (
    receipt: SaveReceipt,
    again: boolean,
    institutionId: string | null,
  ) => void;
  readonly onCancel: () => void;
}): React.ReactElement => {
  const [asset, setAsset] = useState<PickedAsset | null>(seed.asset);
  const [kind, setKind] = useState<EventKind>('split');
  const [factor, setFactor] = useState('');
  const [recordDate, setRecordDate] = useState(seed.date);

  const built = useMemo(
    () => buildEventBody({ assetId: asset?.id ?? null, kind, factor, recordDate }),
    [asset, kind, factor, recordDate],
  );

  const body = built.ok ? built.body : null;
  const preview = usePreview(body === null ? null : JSON.stringify(body), (signal) => {
    if (body === null) throw new Error('sem corpo');
    return previewCorporateEvent(body, signal);
  });
  const save = useSave();

  const errors: FieldErrors = built.ok ? {} : built.errors;
  const visible = useVisibleErrors(errors, {});
  const touch = (field: EntryField) => () => visible.touch(field);

  const submit = async (): Promise<void> => {
    visible.attempt();
    if (!built.ok) return;

    const receipt = await save.run((key) => applyCorporateEvent(built.body, key));
    if (receipt !== null) onSaved(receipt, false, null);
  };

  const current = EVENT_KINDS.find((item) => item.value === kind);

  return (
    <FormShell
      pending={save.pending}
      onSave={() => void submit()}
      onCancel={onCancel}
      saveLabel="Aplicar evento"
      error={save.error}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[0.8125rem] text-ink-2">Tipo de evento</span>
        <Segmented
          label="Tipo de evento"
          options={EVENT_KINDS.map((item) => ({ value: item.value, label: item.label }))}
          value={kind}
          onChange={setKind}
        />
      </div>

      <Field label="Ativo" error={visible.show('asset')}>
        {(control) => (
          <AssetPicker
            control={control}
            invalid={control['aria-invalid']}
            portfolioId={null}
            value={asset}
            onChange={setAsset}
            allowNew={false}
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
        <Field label={current?.factorLabel ?? 'Fator'} error={visible.show('factor')}>
          {(control) => (
            <Input
              {...control}
              numeric
              inputMode="decimal"
              invalid={control['aria-invalid']}
              value={factor}
              onBlur={touch('factor')}
              onChange={(event) => setFactor(event.target.value)}
            />
          )}
        </Field>
      </div>

      <Callout tone="info">{current?.hint}</Callout>

      <EffectPanel
        state={preview}
        rows={eventRows}
        title="Efeito por carteira"
        idle="Informe o ativo, a data-com e o fator para ver o efeito na quantidade e no preço médio."
      />
    </FormShell>
  );
};
