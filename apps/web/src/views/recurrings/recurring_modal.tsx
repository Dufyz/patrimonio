import { useState } from 'react';

import { createRecurring, updateRecurring } from '../../api/recurrings.js';
import type { FinanceCategoryResource, RecurringRequest } from '../../api/recurrings.js';
import { ApiError } from '../../api/client.js';
import { Modal } from '../../components/overlay.js';
import { newAttemptKey } from '../../lib/entry.js';
import type { RecurringKind, RecurringResource } from '../../lib/recurring_view.js';
import { Field, Input, Select } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';

/**
 * REC-03 · Novo e editar recorrente. Aporte não tem categoria, só tem conta de
 * origem e é sempre manual; receita e despesa têm categoria e, na despesa, até
 * duas fontes. O valor é fixo no modo automático e estimativa no manual.
 */
export type SourceOption = {
  /** `conta:<id>` ou `cartao:<id>`. */
  readonly id: string;
  readonly name: string;
  readonly isCard: boolean;
};

type Draft = {
  readonly name: string;
  readonly kind: RecurringKind;
  readonly categoryId: string;
  readonly portfolioId: string;
  readonly source: string;
  readonly secondSource: string;
  readonly coversUpTo: string;
  readonly day: string;
  readonly mode: 'manual' | 'automatico';
  readonly amount: string;
};

const KINDS: readonly { id: RecurringKind; name: string }[] = [
  { id: 'receita', name: 'Receita' },
  { id: 'despesa', name: 'Despesa' },
  { id: 'aporte', name: 'Aporte' },
];

const MODES = [
  { id: 'manual', name: 'Manual (valor estimado)' },
  { id: 'automatico', name: 'Automático (valor fixo)' },
] as const;

const encode = (source: { type: string; id: string } | null): string =>
  source === null ? '' : `${source.type}:${source.id}`;

const decode = (value: string): { type: 'conta' | 'cartao'; id: string } | null => {
  if (value === '') return null;
  const [type, id] = value.split(':');
  return { type: type === 'cartao' ? 'cartao' : 'conta', id: id ?? '' };
};

const normalize = (value: string): string =>
  value.trim().replace(/\./g, '').replace(',', '.');
const validAmount = (value: string): boolean =>
  /^\d+(\.\d{1,2})?$/.test(normalize(value));

export type RecurringErrors = Partial<
  Record<
    'name' | 'category' | 'portfolio' | 'source' | 'day' | 'amount' | 'covers',
    string
  >
>;

export const validateRecurring = (draft: Draft): RecurringErrors => {
  const errors: RecurringErrors = {};
  if (draft.name.trim() === '') errors.name = 'Informe o item.';
  if (draft.kind !== 'aporte' && draft.categoryId === '')
    errors.category = 'Escolha a categoria.';
  if (draft.kind === 'aporte' && draft.portfolioId === '')
    errors.portfolio = 'Escolha a carteira.';
  if (draft.source === '') errors.source = 'Escolha a conta ou o cartão.';
  const day = Number(draft.day);
  if (!Number.isInteger(day) || day < 1 || day > 31) errors.day = 'Dia de 1 a 31.';
  if (!validAmount(draft.amount) || Number(normalize(draft.amount)) <= 0)
    errors.amount = 'Informe um valor maior que zero.';
  if (draft.secondSource !== '') {
    if (!validAmount(draft.coversUpTo) || Number(normalize(draft.coversUpTo)) <= 0)
      errors.covers = 'Informe quanto a primeira fonte cobre.';
    else if (Number(normalize(draft.coversUpTo)) >= Number(normalize(draft.amount)))
      errors.covers = 'A primeira fonte deve cobrir menos que o valor total.';
  }
  return errors;
};

export const toRecurringRequest = (draft: Draft): RecurringRequest => ({
  name: draft.name.trim(),
  kind: draft.kind,
  category_id: draft.kind === 'aporte' ? null : draft.categoryId,
  portfolio_id: draft.kind === 'aporte' ? draft.portfolioId : null,
  asset_id: null,
  source: decode(draft.source) ?? { type: 'conta', id: '' },
  second_source:
    draft.kind === 'despesa' && draft.secondSource !== ''
      ? decode(draft.secondSource)
      : null,
  covers_up_to:
    draft.kind === 'despesa' && draft.secondSource !== ''
      ? Number(normalize(draft.coversUpTo)).toFixed(2)
      : null,
  day: Number(draft.day),
  mode: draft.kind === 'aporte' ? 'manual' : draft.mode,
  amount: Number(normalize(draft.amount)).toFixed(2),
});

const draftOf = (recurring: RecurringResource | undefined): Draft => ({
  name: recurring?.name ?? '',
  kind: recurring?.kind ?? 'despesa',
  categoryId: recurring?.category_id ?? '',
  portfolioId: recurring?.portfolio_id ?? '',
  source: encode(recurring?.source ?? null),
  secondSource: encode(recurring?.second_source ?? null),
  coversUpTo: recurring?.covers_up_to?.replace('.', ',') ?? '',
  day: String(recurring?.day ?? 1),
  mode: recurring?.mode ?? 'manual',
  amount: recurring?.amount.replace('.', ',') ?? '',
});

export const RecurringModal = ({
  editing,
  categories,
  portfolios,
  sources,
  onSaved,
  onClose,
}: {
  readonly editing?: RecurringResource | undefined;
  readonly categories: readonly FinanceCategoryResource[];
  readonly portfolios: readonly { readonly id: string; readonly name: string }[];
  readonly sources: readonly SourceOption[];
  readonly onSaved: () => void;
  readonly onClose: () => void;
}): React.ReactElement => {
  const [draft, setDraft] = useState<Draft>(draftOf(editing));
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const errors = validateRecurring(draft);
  const shown = attempted ? errors : {};
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  const aporte = draft.kind === 'aporte';
  const accountOnly = sources.filter((s) => !s.isCard);
  const available = aporte ? accountOnly : sources;
  const kindCategories = categories.filter(
    (c) => !c.archived && c.kind === (draft.kind === 'receita' ? 'receita' : 'despesa'),
  );

  const submit = async (): Promise<void> => {
    setAttempted(true);
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    setFailure(null);
    try {
      const body = toRecurringRequest(draft);
      if (editing === undefined) await createRecurring(body, newAttemptKey());
      else await updateRecurring(editing.id, body, newAttemptKey());
      onSaved();
      onClose();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      guard
      narrow
      title={editing === undefined ? 'Novo recorrente' : 'Editar recorrente'}
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={failure}
        saveLabel={editing === undefined ? 'Criar recorrente' : 'Salvar'}
        onSave={() => void submit()}
        onCancel={onClose}
      >
        <Field label="Item" error={shown.name}>
          {(p) => (
            <Input
              {...p}
              invalid={p['aria-invalid']}
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
            />
          )}
        </Field>
        <Field label="Tipo">
          {(p) => (
            <Select
              {...p}
              invalid={false}
              options={KINDS}
              value={draft.kind}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  kind: e.target.value as RecurringKind,
                  categoryId: '',
                  secondSource: '',
                  source:
                    e.target.value === 'aporte' && d.source.startsWith('cartao:')
                      ? ''
                      : d.source,
                  mode: e.target.value === 'aporte' ? 'manual' : d.mode,
                }))
              }
            />
          )}
        </Field>
        {aporte ? (
          <Field label="Carteira" error={shown.portfolio}>
            {(p) => (
              <Select
                {...p}
                invalid={p['aria-invalid']}
                placeholder="Escolha a carteira"
                options={portfolios}
                value={draft.portfolioId}
                onChange={(e) => set('portfolioId', e.target.value)}
              />
            )}
          </Field>
        ) : (
          <Field label="Categoria" error={shown.category}>
            {(p) => (
              <Select
                {...p}
                invalid={p['aria-invalid']}
                placeholder="Escolha a categoria"
                options={kindCategories}
                value={draft.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label={aporte ? 'Conta de origem' : 'Pagamento'} error={shown.source}>
          {(p) => (
            <Select
              {...p}
              invalid={p['aria-invalid']}
              placeholder="Escolha a conta ou o cartão"
              options={available}
              value={draft.source}
              onChange={(e) => set('source', e.target.value)}
            />
          )}
        </Field>
        {draft.kind === 'despesa' ? (
          <>
            <Field label="Segunda fonte (opcional)">
              {(p) => (
                <Select
                  {...p}
                  invalid={false}
                  placeholder="Sem segunda fonte"
                  options={available.filter((s) => s.id !== draft.source)}
                  value={draft.secondSource}
                  onChange={(e) => set('secondSource', e.target.value)}
                />
              )}
            </Field>
            {draft.secondSource === '' ? null : (
              <Field label="A primeira fonte cobre até" error={shown.covers}>
                {(p) => (
                  <Input
                    {...p}
                    numeric
                    invalid={p['aria-invalid']}
                    inputMode="decimal"
                    value={draft.coversUpTo}
                    onChange={(e) => set('coversUpTo', e.target.value)}
                  />
                )}
              </Field>
            )}
          </>
        ) : null}
        <Field
          label="Dia do mês"
          error={shown.day}
          hint="Dia 31 em mês curto cai no último dia."
        >
          {(p) => (
            <Input
              {...p}
              numeric
              invalid={p['aria-invalid']}
              inputMode="numeric"
              value={draft.day}
              onChange={(e) => set('day', e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Lançamento"
          hint={aporte ? 'Aporte é sempre manual: você confirma cada mês.' : undefined}
        >
          {(p) => (
            <Select
              {...p}
              invalid={false}
              disabled={aporte}
              options={MODES}
              value={aporte ? 'manual' : draft.mode}
              onChange={(e) => set('mode', e.target.value as Draft['mode'])}
            />
          )}
        </Field>
        <Field
          label={draft.mode === 'manual' || aporte ? 'Valor estimado' : 'Valor'}
          error={shown.amount}
        >
          {(p) => (
            <Input
              {...p}
              numeric
              invalid={p['aria-invalid']}
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => set('amount', e.target.value)}
            />
          )}
        </Field>
      </FormShell>
    </Modal>
  );
};
