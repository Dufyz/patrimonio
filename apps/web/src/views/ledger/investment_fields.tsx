import type { InstitutionOption } from '../entry/institution_picker.js';
import { InstitutionPicker } from '../entry/institution_picker.js';
import { AssetPicker } from '../entry/asset_picker.js';
import { Field, Input, MoneyInput, Select, Toggle } from '../entry/fields.js';
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

  // O total digitado (quantidade × preço ± taxas), só para conferir: quem grava
  // e calcula o efeito é o servidor.
  const num = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const normalized = trimmed.includes(',')
      ? trimmed.replace(/\./g, '').replace(',', '.')
      : trimmed;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const quantity = num(draft.quantity);
  const price = num(draft.unitPrice);
  const fees = num(draft.fees) ?? 0;
  const gross = quantity === null || price === null ? null : quantity * price;
  const totalValue = gross === null ? null : sell ? gross - fees : gross + fees;

  return (
    <>
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
      </div>
      {sell ? null : (
        <Field
          label="Origem"
          error={shown('accountId')}
          hint={'Conta, ou "Fora do app" para registrar histórico.'}
        >
          {(props) => (
            <Select
              {...props}
              invalid={shown('accountId') !== undefined}
              placeholder="Escolha a origem"
              options={accountOptions}
              value={draft.accountId}
              onChange={(e) => set({ accountId: e.target.value })}
            />
          )}
        </Field>
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
      <Field label="Custódia (instituição)" error={shown('institutionId')}>
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
        <Field label="Preço unitário (R$)" error={shown('unitPrice')}>
          {(props) => (
            <MoneyInput
              {...props}
              symbol=""
              maxDecimals={8}
              invalid={shown('unitPrice') !== undefined}
              value={draft.unitPrice}
              onChange={(e) => set({ unitPrice: e.target.value })}
            />
          )}
        </Field>
        <Field label="Taxas (R$)" error={shown('fees')}>
          {(props) => (
            <MoneyInput
              {...props}
              symbol=""
              invalid={shown('fees') !== undefined}
              value={draft.fees}
              placeholder="0,00"
              onChange={(e) => set({ fees: e.target.value })}
            />
          )}
        </Field>
      </div>
      {sell ? (
        <Field label="Conta de destino" error={shown('accountId')}>
          {(props) => (
            <Select
              {...props}
              invalid={shown('accountId') !== undefined}
              placeholder="Escolha a conta"
              options={accountOptions}
              value={draft.accountId}
              onChange={(e) => set({ accountId: e.target.value })}
            />
          )}
        </Field>
      ) : null}
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
        <span className="text-sm text-ink-2">
          {sell ? 'Valor do resgate' : 'Valor do aporte'}
        </span>
        <span className="tabular text-xl font-semibold">
          {totalValue === null
            ? '—'
            : totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
        </span>
      </div>
      {sell ? (
        <>
          <Toggle
            label="Pagar uma despesa com isso"
            checked={draft.linkExpense}
            onChange={(linkExpense) => set({ linkExpense })}
          />
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
