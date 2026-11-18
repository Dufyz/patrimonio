import { useState } from 'react';

import { createRecurring, updateRecurring } from '../../api/recurrings.js';
import type { FinanceCategoryResource, RecurringRequest } from '../../api/recurrings.js';
import { ApiError } from '../../api/client.js';
import { Modal } from '../../components/overlay.js';
import { newAttemptKey } from '../../lib/entry.js';
import type { RecurringKind, RecurringResource } from '../../lib/recurring_view.js';
import {
  Callout,
  Field,
  Input,
  MoneyInput,
  NoteField,
  Select,
  Toggle,
} from '../entry/fields.js';
import { KindSelect } from '../ledger/kind_select.js';
import type { ModalKind } from '../../lib/ledger_entry_form.js';
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
  readonly note: string;
};

// Aporte não é recorrente: o valor investido sai como despesa (categoria) e a
// compra de ativos se lança em Posições. O recorrente de aporte que já existir
// ainda abre para edição.
const KINDS: readonly RecurringKind[] = ['receita', 'despesa'];
const KIND_SUBTITLE: Readonly<Record<RecurringKind, string>> = {
  receita: 'Receita · entra todo mês em uma conta',
  despesa: 'Despesa · sai todo mês de uma conta ou cartão',
  aporte: 'Aporte · conta → carteira, confirmado mês a mês',
};
const KIND_NAME: Readonly<Record<RecurringKind, string>> = {
  receita: 'receita',
  despesa: 'despesa',
  aporte: 'aporte',
};

const DAYS = Array.from({ length: 31 }, (_, index) => ({
  id: String(index + 1),
  name: `Dia ${index + 1}`,
}));

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
  note: draft.note.trim() === '' ? null : draft.note.trim(),
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
  note: recurring?.note ?? '',
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
      subtitle={KIND_SUBTITLE[draft.kind]}
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={failure}
        saveLabel={
          editing === undefined ? `Criar ${KIND_NAME[draft.kind]} recorrente` : 'Salvar'
        }
        onSave={() => void submit()}
        onCancel={onClose}
      >
        <Field label="Tipo">
          {(p) => (
            <KindSelect
              id={p.id}
              kinds={(draft.kind === 'aporte'
                ? [...KINDS, 'aporte' as const]
                : KINDS
              ).map((k) => k.toUpperCase() as ModalKind)}
              value={draft.kind.toUpperCase() as ModalKind}
              onChange={(next) => {
                const kind = next.toLowerCase() as RecurringKind;
                setDraft((d) => ({
                  ...d,
                  kind,
                  categoryId: '',
                  secondSource: '',
                  source:
                    kind === 'aporte' && d.source.startsWith('cartao:') ? '' : d.source,
                  mode: kind === 'aporte' ? 'manual' : d.mode,
                }));
              }}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Dia do mês"
            error={shown.day}
            hint="Dia 31 em mês curto cai no último dia."
          >
            {(p) => (
              <Select
                {...p}
                invalid={p['aria-invalid']}
                options={DAYS}
                value={draft.day}
                onChange={(e) => set('day', e.target.value)}
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
        </div>
        <Field label="Descrição" error={shown.name}>
          {(p) => (
            <Input
              {...p}
              invalid={p['aria-invalid']}
              value={draft.name}
              placeholder={
                aporte
                  ? 'Aporte mensal'
                  : draft.kind === 'receita'
                    ? 'Salário'
                    : 'Aluguel'
              }
              onChange={(e) => set('name', e.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label={
              aporte
                ? 'Conta de origem'
                : draft.kind === 'receita'
                  ? 'Conta de destino'
                  : 'Pago com'
            }
            error={shown.source}
          >
            {(p) => (
              <Select
                {...p}
                invalid={p['aria-invalid']}
                placeholder={
                  draft.kind === 'despesa'
                    ? 'Escolha a conta ou o cartão'
                    : 'Escolha a conta'
                }
                options={(draft.kind === 'despesa' ? available : accountOnly).map(
                  (s) => ({
                    id: s.id,
                    name: s.isCard
                      ? `${s.name.replace(/ \(cartão\)$/u, '')} · cartão`
                      : s.name,
                  }),
                )}
                value={draft.source}
                onChange={(e) => set('source', e.target.value)}
              />
            )}
          </Field>
          <Field
            label={
              draft.mode === 'manual' || aporte ? 'Valor estimado (R$)' : 'Valor (R$)'
            }
            error={shown.amount}
          >
            {(p) => (
              <MoneyInput
                {...p}
                symbol=""
                invalid={p['aria-invalid']}
                value={draft.amount}
                onChange={(e) => set('amount', e.target.value)}
              />
            )}
          </Field>
        </div>
        {draft.kind === 'despesa' ? (
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Divisão"
              hint={
                draft.secondSource === ''
                  ? 'Opcional: parte em outra conta ou cartão.'
                  : undefined
              }
            >
              {(p) => (
                <Select
                  {...p}
                  invalid={false}
                  placeholder="Não dividir"
                  options={available
                    .filter((s) => s.id !== draft.source)
                    .map((s) => ({ id: s.id, name: `Dividir com ${s.name}` }))}
                  value={draft.secondSource}
                  onChange={(e) => set('secondSource', e.target.value)}
                />
              )}
            </Field>
            {draft.secondSource === '' ? null : (
              <Field
                label="A primeira origem cobre até (R$)"
                error={shown.covers}
                hint="O resto sai da segunda."
              >
                {(p) => (
                  <MoneyInput
                    {...p}
                    symbol=""
                    invalid={p['aria-invalid']}
                    value={draft.coversUpTo}
                    onChange={(e) => set('coversUpTo', e.target.value)}
                  />
                )}
              </Field>
            )}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Toggle
            label="Lançar sozinho no dia"
            checked={!aporte && draft.mode === 'automatico'}
            disabled={aporte}
            onChange={(on) => set('mode', on ? 'automatico' : 'manual')}
          />
          <span className="text-[0.8125rem] text-ink-2">
            Situação:{' '}
            <span className="font-semibold text-ink">
              {!aporte && draft.mode === 'automatico' ? 'Lançado no dia' : 'Previsto'}
            </span>
          </span>
        </div>
        <NoteField
          value={draft.note}
          placeholder="Detalhes que não cabem na descrição"
          onChange={(note) => set('note', note)}
        />
        <Callout tone="info">
          {aporte
            ? `Todo dia ${draft.day} nasce um aporte previsto; você confirma com ativo, quantidade e preço. Aporte é despesa financeira: o patrimônio não muda.`
            : draft.mode === 'automatico'
              ? `Todo dia ${draft.day} a movimentação entra sozinha, com o valor fixo. Dá para pular um mês ou pausar.`
              : `Todo dia ${draft.day} nasce um previsto com o valor estimado; ao lançar, você confirma o valor real.`}
        </Callout>
      </FormShell>
    </Modal>
  );
};
