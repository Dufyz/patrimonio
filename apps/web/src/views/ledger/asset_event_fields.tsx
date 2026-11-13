import { AssetPicker } from '../entry/asset_picker.js';
import { Field, Input, Select } from '../entry/fields.js';
import { InstitutionPicker } from '../entry/institution_picker.js';
import type { InstitutionOption } from '../entry/institution_picker.js';
import {
  EVENT_KIND_LABEL,
  OUTSIDE,
  PAYOUT_KIND_LABEL,
} from '../../lib/ledger_entry_form.js';
import type { Draft, DraftErrors } from '../../lib/ledger_entry_form.js';

type Named = { readonly id: string; readonly name: string };

const options = (labels: Readonly<Record<string, string>>): readonly Named[] =>
  Object.entries(labels).map(([id, name]) => ({ id, name }));

/**
 * LAN-16 e LAN-17 · Os campos de provento (ativo com posição, tipo, valor, data,
 * conta) e de evento (ativo, tipo, fator, data; sem valor, conta nem saldo).
 */
export const AssetEventFields = ({
  draft,
  set,
  errors,
  attempted,
  accounts,
  portfolios,
  institutions,
}: {
  readonly draft: Draft;
  readonly set: (patch: Partial<Draft>) => void;
  readonly errors: DraftErrors;
  readonly attempted: boolean;
  readonly accounts: readonly Named[];
  readonly portfolios: readonly Named[];
  readonly institutions: readonly InstitutionOption[];
}): React.ReactElement => {
  const shown = (field: keyof Draft): string | undefined =>
    attempted ? errors[field] : undefined;
  const event = draft.kind === 'EVENTO';

  return (
    <>
      {event ? null : (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Carteira" error={shown('portfolioId')}>
            {(props) => (
              <Select
                {...props}
                invalid={shown('portfolioId') !== undefined}
                placeholder="Escolha a carteira"
                options={portfolios}
                value={draft.portfolioId}
                onChange={(e) => set({ portfolioId: e.target.value })}
              />
            )}
          </Field>
          <Field label="Instituição" error={shown('institutionId')}>
            {(props) => (
              <InstitutionPicker
                control={props}
                invalid={shown('institutionId') !== undefined}
                options={institutions}
                value={draft.institutionId === '' ? null : draft.institutionId}
                onChange={(id) => set({ institutionId: id ?? '' })}
              />
            )}
          </Field>
        </div>
      )}
      <Field label="Ativo" error={shown('asset')}>
        {(props) => (
          <AssetPicker
            control={props}
            invalid={shown('asset') !== undefined}
            value={draft.asset}
            onChange={(asset) => set({ asset })}
            portfolioId={draft.portfolioId === '' ? null : draft.portfolioId}
            allowNew={false}
          />
        )}
      </Field>
      {event ? (
        <>
          <Field label="Tipo">
            {(props) => (
              <Select
                {...props}
                invalid={false}
                options={options(EVENT_KIND_LABEL)}
                value={draft.eventKind}
                onChange={(e) => set({ eventKind: e.target.value })}
              />
            )}
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Cada" error={shown('ratioFrom')}>
              {(props) => (
                <Input
                  {...props}
                  numeric
                  inputMode="decimal"
                  invalid={shown('ratioFrom') !== undefined}
                  value={draft.ratioFrom}
                  onChange={(e) => set({ ratioFrom: e.target.value })}
                />
              )}
            </Field>
            <Field label="Viram" error={shown('ratioTo')}>
              {(props) => (
                <Input
                  {...props}
                  numeric
                  inputMode="decimal"
                  invalid={shown('ratioTo') !== undefined}
                  value={draft.ratioTo}
                  onChange={(e) => set({ ratioTo: e.target.value })}
                />
              )}
            </Field>
            <Field label="Data-com" error={shown('date')}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  invalid={shown('date') !== undefined}
                  value={draft.date}
                  onChange={(e) => set({ date: e.target.value })}
                />
              )}
            </Field>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tipo">
              {(props) => (
                <Select
                  {...props}
                  invalid={false}
                  options={options(PAYOUT_KIND_LABEL)}
                  value={draft.payoutKind}
                  onChange={(e) => set({ payoutKind: e.target.value })}
                />
              )}
            </Field>
            <Field label="Valor bruto" error={shown('amount')}>
              {(props) => (
                <Input
                  {...props}
                  numeric
                  inputMode="decimal"
                  invalid={shown('amount') !== undefined}
                  value={draft.amount}
                  onChange={(e) => set({ amount: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Data do pagamento" error={shown('date')}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  invalid={shown('date') !== undefined}
                  value={draft.date}
                  onChange={(e) => set({ date: e.target.value })}
                />
              )}
            </Field>
            <Field label="Data-com">
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  invalid={false}
                  value={draft.recordDate}
                  onChange={(e) => set({ recordDate: e.target.value })}
                />
              )}
            </Field>
            <Field label="IR retido" error={shown('tax')}>
              {(props) => (
                <Input
                  {...props}
                  numeric
                  inputMode="decimal"
                  invalid={shown('tax') !== undefined}
                  value={draft.tax}
                  onChange={(e) => set({ tax: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field label="Conta" error={shown('accountId')}>
            {(props) => (
              <Select
                {...props}
                invalid={shown('accountId') !== undefined}
                placeholder="Escolha a conta que recebe"
                options={[...accounts, { id: OUTSIDE, name: 'Fora do app' }]}
                value={draft.accountId}
                onChange={(e) => set({ accountId: e.target.value })}
              />
            )}
          </Field>
        </>
      )}
    </>
  );
};
