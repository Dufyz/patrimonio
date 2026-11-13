import { useEffect, useMemo, useState } from 'react';

import { fetchInstitutions } from '../../api/institutions.js';
import { ApiError } from '../../api/client.js';
import {
  fetchCards,
  fetchCategories,
  previewEntry,
  saveEntry,
} from '../../api/ledger_write.js';
import type { CardOption, CategoryOption } from '../../api/ledger_write.js';
import { usePortfolios } from '../../components/portfolios_provider.js';
import { EffectTable } from '../../components/effect_table.js';
import { Modal } from '../../components/overlay.js';
import { Segmented } from '../../components/primitives.js';
import { newAttemptKey } from '../../lib/entry.js';
import {
  isAssetEvent,
  isInvestment,
  previewRows,
  isValid,
  MODAL_KIND_LABEL,
  MODAL_KINDS,
  newDraft,
  switchKind,
  toRequest,
  validateDraft,
} from '../../lib/ledger_entry_form.js';
import type { Draft, DraftContext, ModalKind } from '../../lib/ledger_entry_form.js';
import { Field, Input, Select } from '../entry/fields.js';
import { FormShell } from '../entry/form_shell.js';
import { usePreview } from '../entry/hooks.js';
import { AssetEventFields } from './asset_event_fields.js';
import { InvestmentFields } from './investment_fields.js';

/**
 * LAN-09 · O modal "Novo lançamento": um componente, um seletor de tipo.
 *
 * Cada tipo entra à medida que o servidor o grava (LAN-10 a LAN-17); hoje,
 * receita e despesa. O bloco "Efeito" vem de `?preview=true` e recalcula a cada
 * alteração, com debounce. `⌘↵` salva; `⇧↵` salva e abre outro com tipo e conta
 * mantidos. Cada submissão leva uma `Idempotency-Key` nova.
 */
export const NewEntryModal = ({
  today,
  accounts,
  context = {},
  initialKind,
  onSaved,
  onClose,
  onConflict,
}: {
  readonly today: string;
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly context?: DraftContext;
  readonly initialKind?: ModalKind;
  readonly onSaved: () => void;
  readonly onClose: () => void;
  /** CRT-10 · Pagar fatura que já mudou: mostra o erro e pede para quem abriu recarregar. */
  readonly onConflict?: (() => void) | undefined;
}): React.ReactElement => {
  const [draft, setDraft] = useState<Draft>(() => newDraft(today, context, initialKind));
  const [categories, setCategories] = useState<readonly CategoryOption[]>([]);
  const [cards, setCards] = useState<readonly CardOption[]>([]);
  const [institutions, setInstitutions] = useState<
    readonly { id: string; name: string }[]
  >([]);
  const { portfolios } = usePortfolios();
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    fetchInstitutions()
      .then((list) => setInstitutions(list.map((i) => ({ id: i.id, name: i.name }))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchCards()
      .then(setCards)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  const errors = validateDraft(draft, today);
  const valid = isValid(errors);
  const shown = (field: keyof Draft): string | undefined =>
    attempted ? errors[field] : undefined;
  const set = (patch: Partial<Draft>): void => setDraft((d) => ({ ...d, ...patch }));

  const body = useMemo(() => (valid ? toRequest(draft) : null), [valid, draft]);
  const preview = usePreview(body === null ? null : JSON.stringify(body), (signal) =>
    previewEntry(body as NonNullable<typeof body>, signal),
  );

  const transfer = draft.kind === 'TRANSFERENCIA';
  const payment = draft.kind === 'PAGAMENTO_FATURA';
  // Fatura paga não tem o que pagar; prevista ainda não pode ser paga.
  const payable = cards.filter((c) => c.status !== 'paga' && c.status !== 'prevista');
  const pickCard = (id: string): void => {
    const card = cards.find((c) => c.id === id);
    setDraft((d) => ({
      ...d,
      cardId: id,
      month: card?.month ?? '',
      accountId: card?.payAccountId ?? d.accountId,
      amount: card?.remaining ?? d.amount,
    }));
  };
  const options = categories
    .filter((c) => c.kind === (draft.kind === 'RECEITA' ? 'receita' : 'despesa'))
    .map((c) => ({ id: c.id, name: c.name }));

  const submit = async (again: boolean): Promise<void> => {
    setAttempted(true);
    if (body === null) return;
    setPending(true);
    setFailure(null);
    try {
      await saveEntry(body, newAttemptKey());
      onSaved();
      if (again) {
        setDraft((d) => ({
          ...newDraft(
            today,
            { accountId: d.accountId, portfolioId: d.portfolioId },
            d.kind,
          ),
          institutionId: d.institutionId,
        }));
        setAttempted(false);
      } else {
        onClose();
      }
    } catch (error) {
      // Falha de rede ou da api mantém o formulário como está.
      setFailure(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
      if (error instanceof ApiError && (error.status === 409 || error.status === 422))
        onConflict?.();
    } finally {
      setPending(false);
    }
  };

  const effect = preview.status === 'ready' ? preview.value : null;
  const inv = isInvestment(draft.kind);
  const expenseOptions = categories
    .filter((c) => c.kind === 'despesa')
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <Modal open guard narrow title="Novo lançamento" onClose={onClose}>
      <FormShell
        pending={pending}
        error={failure}
        saveLabel="Lançar"
        onSave={() => void submit(false)}
        onSaveAgain={() => void submit(true)}
        onCancel={onClose}
      >
        <Segmented
          label="Tipo"
          value={draft.kind}
          onChange={(kind) => setDraft((d) => switchKind(d, kind))}
          options={MODAL_KINDS.map((kind) => ({
            value: kind,
            label: MODAL_KIND_LABEL[kind],
          }))}
        />
        {isAssetEvent(draft.kind) ? (
          <AssetEventFields
            draft={draft}
            set={set}
            errors={errors}
            attempted={attempted}
            accounts={accounts}
            portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))}
            institutions={institutions}
          />
        ) : inv ? (
          <InvestmentFields
            draft={draft}
            set={set}
            errors={errors}
            attempted={attempted}
            accounts={accounts}
            portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))}
            institutions={institutions}
            expenseCategories={expenseOptions}
          />
        ) : (
          <>
            {payment ? (
              <Field label="Cartão" error={shown('cardId')}>
                {(props) => (
                  <Select
                    {...props}
                    invalid={shown('cardId') !== undefined}
                    placeholder="Escolha o cartão"
                    options={payable}
                    value={draft.cardId}
                    onChange={(e) => pickCard(e.target.value)}
                  />
                )}
              </Field>
            ) : (
              <Field
                label={transfer ? 'Descrição (opcional)' : 'Descrição'}
                error={shown('description')}
              >
                {(props) => (
                  <Input
                    {...props}
                    invalid={shown('description') !== undefined}
                    value={draft.description}
                    onChange={(e) => set({ description: e.target.value })}
                  />
                )}
              </Field>
            )}
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
              <Field label="Valor" error={shown('amount')}>
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
            <div className="grid grid-cols-2 gap-4">
              <Field
                label={
                  transfer
                    ? 'De'
                    : draft.kind === 'RECEITA'
                      ? 'Conta de destino'
                      : 'Conta'
                }
                error={shown('accountId')}
              >
                {(props) => (
                  <Select
                    {...props}
                    invalid={shown('accountId') !== undefined}
                    placeholder={transfer ? 'Conta de origem' : 'Escolha a conta'}
                    options={accounts}
                    value={draft.accountId}
                    onChange={(e) => set({ accountId: e.target.value })}
                  />
                )}
              </Field>
              {transfer ? (
                <Field label="Para" error={shown('toAccountId')}>
                  {(props) => (
                    <Select
                      {...props}
                      invalid={shown('toAccountId') !== undefined}
                      placeholder="Conta de destino"
                      options={accounts}
                      value={draft.toAccountId}
                      onChange={(e) => set({ toAccountId: e.target.value })}
                    />
                  )}
                </Field>
              ) : payment ? null : (
                <Field label="Categoria" error={shown('categoryId')}>
                  {(props) => (
                    <Select
                      {...props}
                      invalid={shown('categoryId') !== undefined}
                      placeholder="Escolha a categoria"
                      options={options}
                      value={draft.categoryId}
                      onChange={(e) => set({ categoryId: e.target.value })}
                    />
                  )}
                </Field>
              )}
            </div>
          </>
        )}
        {effect === null ? null : (
          <EffectTable
            rows={previewRows(
              effect,
              (id) => accounts.find((a) => a.id === id)?.name ?? null,
            )}
            busy={preview.status === 'loading'}
          />
        )}
        {preview.status === 'error' ? (
          <p role="alert" className="text-[0.8125rem] text-negative">
            {preview.message}
          </p>
        ) : null}
      </FormShell>
    </Modal>
  );
};
