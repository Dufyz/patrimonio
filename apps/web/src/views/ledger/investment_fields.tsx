import type { InstitutionOption } from '../entry/institution_picker.js';
import { InstitutionPicker } from '../entry/institution_picker.js';
import { AssetPicker } from '../entry/asset_picker.js';
import { Field, Input, Select } from '../entry/fields.js';
import { OUTSIDE } from '../../lib/ledger_entry_form.js';
import type { Draft, DraftErrors } from '../../lib/ledger_entry_form.js';

type Named = { readonly id: string; readonly name: string };

/**
 * LAN-14 e LAN-15 · Os campos de aporte e resgate: carteira, ativo da lista
 * (sem cadastro manual), instituição, quantidade, preço, taxas, data e a conta.
 * No resgate, a opção de gerar a despesa ligada (RN-U6).
 */
export const InvestmentFields = ({
  draft,
  set,
  errors,
  attempted,
  accounts,
  portfolios,
  institutions,
  expenseCategories,
}: {
  readonly draft: Draft;
  readonly set: (patch: Partial<Draft>) => void;
  readonly errors: DraftErrors;
  readonly attempted: boolean;
  readonly accounts: readonly Named[];
  readonly portfolios: readonly Named[];
  readonly institutions: readonly InstitutionOption[];
  readonly expenseCategories: readonly Named[];
}): React.ReactElement => {
  const shown = (field: keyof Draft): string | undefined =>
    attempted ? errors[field] : undefined;
  const sell = draft.kind === 'RESGATE';
  const accountOptions = [...accounts, { id: OUTSIDE, name: 'Fora do app' }];

  return (
    <>
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
      </div>
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
      <div className="grid grid-cols-3 gap-4">
        <Field label="Quantidade" error={shown('quantity')}>
          {(props) => (
            <Input
              {...props}
              numeric
              inputMode="decimal"
              invalid={shown('quantity') !== undefined}
              value={draft.quantity}
              onChange={(e) => set({ quantity: e.target.value })}
            />
          )}
        </Field>
        <Field label="Preço" error={shown('unitPrice')}>
          {(props) => (
            <Input
              {...props}
              numeric
              inputMode="decimal"
              invalid={shown('unitPrice') !== undefined}
              value={draft.unitPrice}
              onChange={(e) => set({ unitPrice: e.target.value })}
            />
          )}
        </Field>
        <Field label="Taxas" error={shown('fees')}>
          {(props) => (
            <Input
              {...props}
              numeric
              inputMode="decimal"
              invalid={shown('fees') !== undefined}
              value={draft.fees}
              onChange={(e) => set({ fees: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Data" error={shown('date')}>
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
        <Field label={sell ? 'Conta de destino' : 'Origem'} error={shown('accountId')}>
          {(props) => (
            <Select
              {...props}
              invalid={shown('accountId') !== undefined}
              placeholder={sell ? 'Escolha a conta' : 'Escolha a origem'}
              options={accountOptions}
              value={draft.accountId}
              onChange={(e) => set({ accountId: e.target.value })}
            />
          )}
        </Field>
      </div>
      {sell ? (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.linkExpense}
              onChange={(e) => set({ linkExpense: e.target.checked })}
            />
            Gerar despesa ligada
          </label>
          {draft.linkExpense ? (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Categoria da despesa" error={shown('categoryId')}>
                {(props) => (
                  <Select
                    {...props}
                    invalid={shown('categoryId') !== undefined}
                    placeholder="Escolha a categoria"
                    options={expenseCategories}
                    value={draft.categoryId}
                    onChange={(e) => set({ categoryId: e.target.value })}
                  />
                )}
              </Field>
              <Field label="Descrição da despesa">
                {(props) => (
                  <Input
                    {...props}
                    invalid={false}
                    value={draft.description}
                    onChange={(e) => set({ description: e.target.value })}
                  />
                )}
              </Field>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
};
