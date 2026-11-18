import { useEffect, useMemo, useState } from 'react';

import { useEntry } from '../../components/entry_provider.js';
import type { EntryTab } from '../../lib/entry.js';

import { ApiError } from '../../api/client.js';
import {
  fetchCards,
  fetchCategories,
  previewEntry,
  saveEntry,
} from '../../api/ledger_write.js';
import type { CardOption, CategoryOption } from '../../api/ledger_write.js';
import { EffectTable } from '../../components/effect_table.js';
import { Modal } from '../../components/overlay.js';
import { KindSelect } from './kind_select.js';
import { deleteBookRow, putFinanceEntry } from '../../api/book.js';
import { newAttemptKey } from '../../lib/entry.js';
import {
  decodeSource,
  draftFromEntry,
  previewRows,
  isValid,
  isPlannable,
  MODAL_KIND_SUBTITLE,
  newDraft,
  switchKind,
  toRequest,
  validateDraft,
} from '../../lib/ledger_entry_form.js';
import type {
  Draft,
  DraftContext,
  EditableEntry,
  ModalKind,
} from '../../lib/ledger_entry_form.js';
import {
  Callout,
  Field,
  Input,
  MoneyInput,
  NoteField,
  Select,
  Toggle,
} from '../entry/fields.js';
import { createRecurring, skipRecurringMonth } from '../../api/recurrings.js';
import { FormShell } from '../entry/form_shell.js';
import { usePreview } from '../entry/hooks.js';
import { DatePicker } from '../../components/date_picker.js';

const NOTICE: Partial<Record<ModalKind, React.ReactNode>> = {
  APORTE: (
    <>
      Patrimônio total: <strong>não muda</strong>. Sai da conta como despesa financeira e
      entra na carteira.
    </>
  ),
  RESGATE: (
    <>
      Patrimônio total: <strong>não muda</strong> pelo resgate. Se pagar uma despesa, ela
      é lançada junto e o patrimônio cai.
    </>
  ),
  PROVENTO:
    'Provento é rendimento, não receita: entra na conta mas fica fora de Receitas e do saldo do mês.',
  EVENTO: 'Sem valor e sem efeito no aportado: mantém o preço médio e não é venda.',
};

/**
 * Aporte, resgate, provento e evento são transações de posição: o modal de
 * movimentação entrega para o formulário de investimento de Posições, que é o
 * formulário completo (ativo, liquidação, taxas, efeito na posição) e também
 * move a conta. Um formulário só para cada coisa.
 */
const POSITION_TAB: Partial<Record<ModalKind, EntryTab>> = {
  APORTE: 'buy',
  RESGATE: 'sell',
  PROVENTO: 'payout',
  EVENTO: 'event',
};

const INSTALLMENT_OPTIONS = Array.from({ length: 24 }, (_, index) => ({
  id: String(index + 1),
  name: index === 0 ? 'À vista (1x)' : `${index + 1}x`,
}));

/**
 * Receita ou despesa com "Repetir todo mês": cria o recorrente do mesmo item e
 * pula o mês do lançamento, que já existe (o recorrente começa no mês seguinte).
 */
const createRepeat = async (draft: Draft): Promise<void> => {
  const amount = (value: string): string =>
    value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value;
  const split = draft.kind === 'DESPESA' && draft.splitSource !== '';
  const second = split ? decodeSource(draft.splitSource) : null;
  const total = Number(amount(draft.amount));
  const created = (await createRecurring(
    {
      name: draft.description.trim(),
      kind: draft.kind === 'RECEITA' ? 'receita' : 'despesa',
      category_id: draft.categoryId,
      portfolio_id: null,
      asset_id: null,
      source: { type: draft.sourceType, id: draft.accountId },
      second_source:
        second === null ? null : { type: second.source_type, id: second.source_id },
      covers_up_to: split ? (total - Number(amount(draft.splitAmount))).toFixed(2) : null,
      day: Number(draft.date.slice(8, 10)),
      mode: 'manual',
      amount: total.toFixed(2),
      note: draft.note.trim() === '' ? null : draft.note.trim(),
    },
    newAttemptKey(),
  )) as { recurring?: { id?: string }; id?: string } | null;
  const id = created?.recurring?.id ?? created?.id;
  if (id !== undefined)
    await skipRecurringMonth(id, draft.date.slice(0, 7), newAttemptKey());
};

const MODAL_KIND_LABEL_LOWER: Readonly<Record<ModalKind, string>> = {
  RECEITA: 'receita',
  DESPESA: 'despesa',
  TRANSFERENCIA: 'transferência',
  PAGAMENTO_FATURA: 'pagamento',
  APORTE: 'aporte',
  RESGATE: 'resgate',
  PROVENTO: 'provento',
  EVENTO: 'evento',
};

/**
 * LAN-09 · O modal "Nova movimentação": um componente, um seletor de tipo.
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
  prefill,
  onSaved,
  onClose,
  onConflict,
  editing,
}: {
  readonly today: string;
  readonly accounts: readonly { readonly id: string; readonly name: string }[];
  readonly context?: DraftContext;
  readonly initialKind?: ModalKind;
  /** LAN-06 · Lançar um aporte previsto: o modal abre com os dados do previsto. */
  readonly prefill?: Partial<Draft> | undefined;
  readonly onSaved: () => void;
  readonly onClose: () => void;
  /** CRT-10 · Pagar fatura que já mudou: mostra o erro e pede para quem abriu recarregar. */
  readonly onConflict?: (() => void) | undefined;
  /** LAN-07 · Editar receita ou despesa lançada: abre o formulário do tipo preenchido. */
  readonly editing?: { readonly id: string; readonly entry: EditableEntry } | undefined;
}): React.ReactElement => {
  const [draft, setDraft] = useState<Draft>(() =>
    editing === undefined
      ? { ...newDraft(today, context, initialKind), ...prefill }
      : draftFromEntry(today, editing.entry),
  );
  const entry = useEntry();
  const positionTab = POSITION_TAB[draft.kind];
  useEffect(() => {
    if (positionTab === undefined) return;
    onClose();
    // Editando uma receita ou despesa e trocando para aporte, resgate, provento
    // ou evento: a movimentação nova nasce no formulário de investimento e a
    // original é excluída depois que a nova grava.
    const original = editing;
    entry.openEntry({
      tab: positionTab,
      ...(draft.portfolioId === '' ? {} : { portfolioId: draft.portfolioId }),
      ...(original === undefined
        ? {}
        : {
            replaces: {
              label: `“${original.entry.description}”`,
              remove: () => deleteBookRow(`/api/finance/entries/${original.id}`),
            },
          }),
    });
    // Só a troca de tipo decide; o resto do rascunho não reabre nada.
  }, [positionTab]);
  const [categories, setCategories] = useState<readonly CategoryOption[]>([]);
  const [cards, setCards] = useState<readonly CardOption[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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
  const preview = usePreview(
    body === null || editing !== undefined ? null : JSON.stringify(body),
    (signal) => previewEntry(body as NonNullable<typeof body>, signal),
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
  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name }));
  // Despesa sai de conta ou de cartão (prancha 07: "Nubank Mastercard · cartão").
  const payWith = [
    ...accounts.map((a) => ({ id: `conta:${a.id}`, name: a.name })),
    ...cards.map((c) => ({ id: `cartao:${c.id}`, name: `${c.name} · cartão` })),
  ];
  const options = categories
    .filter((c) => c.kind === (draft.kind === 'RECEITA' ? 'receita' : 'despesa'))
    .map((c) => ({ id: c.id, name: c.name }));

  const submit = async (again: boolean): Promise<void> => {
    setAttempted(true);
    if (body === null) return;
    setPending(true);
    setFailure(null);
    try {
      if (editing === undefined) await saveEntry(body, newAttemptKey());
      else await putFinanceEntry(editing.id, body.body as Record<string, unknown>);
      if (editing === undefined && draft.repeat && isPlannable(draft.kind)) {
        await createRepeat(draft);
      }
      onSaved();
      if (again && editing === undefined) {
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

  const saveLabel =
    editing !== undefined
      ? 'Salvar'
      : `${draft.planned && isPlannable(draft.kind) ? 'Prever' : 'Lançar'} ${MODAL_KIND_LABEL_LOWER[draft.kind]}`;
  const effect = preview.status === 'ready' ? preview.value : null;
  // A nota de rodapé de cada tipo (prancha 07): o que o lançamento faz e não faz.
  const notice: React.ReactNode =
    draft.undated && isPlannable(draft.kind)
      ? 'Previsto sem data: fica fora do saldo previsto e dos totais até ganhar uma data. Aparece em Movimentações, em "Previstos sem data".'
      : draft.kind === 'DESPESA' && draft.sourceType === 'cartao'
        ? 'A compra entra em Despesas hoje; a conta só é debitada quando a fatura for paga.'
        : draft.kind === 'TRANSFERENCIA'
          ? 'Transferência não é receita nem despesa: totais e patrimônio não mudam. Saldo insuficiente na origem: o app avisa, mas deixa salvar.'
          : draft.kind === 'PAGAMENTO_FATURA'
            ? 'Pagar fatura não é despesa: as compras já entraram em Despesas na data de cada compra.'
            : draft.repeat && isPlannable(draft.kind) && draft.date !== ''
              ? `Cria também o recorrente: um previsto todo dia ${Number(draft.date.slice(8, 10))}, a partir do mês seguinte.`
              : (NOTICE[draft.kind] ?? null);

  return (
    <Modal
      open
      guard
      narrow
      title={editing === undefined ? 'Nova movimentação' : 'Editar movimentação'}
      subtitle={MODAL_KIND_SUBTITLE[draft.kind]}
      onClose={onClose}
    >
      <FormShell
        pending={pending}
        error={failure}
        saveLabel={saveLabel}
        onSave={() => void submit(false)}
        {...(editing === undefined ? { onSaveAgain: () => void submit(true) } : {})}
        onCancel={onClose}
      >
        <Field label="Tipo">
          {(props) => (
            <KindSelect
              id={props.id}
              value={draft.kind}
              onChange={(kind) => setDraft((d) => switchKind(d, kind))}
            />
          )}
        </Field>
        {positionTab !== undefined ? null : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Data" error={shown('date') ?? shown('undated')}>
                {(props) => (
                  // A situação vem da data: hoje ou antes é lançado; depois de
                  // hoje é previsto; sem data é previsto de data incerta.
                  <DatePicker
                    id={props.id}
                    aria-describedby={props['aria-describedby']}
                    invalid={(shown('date') ?? shown('undated')) !== undefined}
                    value={draft.undated ? '' : draft.date}
                    {...(isPlannable(draft.kind) ? { emptyLabel: 'Sem data' } : {})}
                    onChange={(value) =>
                      set(
                        value === ''
                          ? { undated: true, planned: true, repeat: false }
                          : {
                              date: value,
                              undated: false,
                              planned: isPlannable(draft.kind) && value > today,
                            },
                      )
                    }
                  />
                )}
              </Field>
              {payment || transfer ? (
                <Field label="Valor (R$)" error={shown('amount')}>
                  {(props) => (
                    <MoneyInput
                      {...props}
                      symbol=""
                      invalid={shown('amount') !== undefined}
                      value={draft.amount}
                      onChange={(e) => set({ amount: e.target.value })}
                    />
                  )}
                </Field>
              ) : (
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
            {transfer || payment ? null : (
              <Field label="Descrição" error={shown('description')}>
                {(props) => (
                  <Input
                    {...props}
                    invalid={shown('description') !== undefined}
                    value={draft.description}
                    placeholder={
                      draft.kind === 'RECEITA'
                        ? 'Salário · dezembro'
                        : 'Mercado · Pão de Açúcar'
                    }
                    onChange={(e) => set({ description: e.target.value })}
                  />
                )}
              </Field>
            )}
            <div className="grid grid-cols-2 gap-4">
              {payment ? (
                <Field label="Cartão" error={shown('cardId')}>
                  {(props) => (
                    <Select
                      {...props}
                      invalid={shown('cardId') !== undefined}
                      placeholder="Escolha o cartão"
                      options={payable.map((c) => ({
                        id: c.id,
                        name: `${c.name} · fatura de ${c.month.slice(5, 7)}/${c.month.slice(2, 4)}`,
                      }))}
                      value={draft.cardId}
                      onChange={(e) => pickCard(e.target.value)}
                    />
                  )}
                </Field>
              ) : null}
              <Field
                label={
                  transfer
                    ? 'Origem'
                    : draft.kind === 'RECEITA'
                      ? 'Conta de destino'
                      : 'Pago com'
                }
                error={shown('accountId')}
              >
                {(props) => (
                  <Select
                    {...props}
                    invalid={shown('accountId') !== undefined}
                    placeholder={
                      draft.kind === 'DESPESA'
                        ? 'Escolha a conta ou o cartão'
                        : 'Escolha a conta'
                    }
                    options={draft.kind === 'DESPESA' ? payWith : accountOptions}
                    value={
                      draft.kind === 'DESPESA'
                        ? draft.accountId === ''
                          ? ''
                          : `${draft.sourceType}:${draft.accountId}`
                        : draft.accountId
                    }
                    onChange={(e) => {
                      if (draft.kind !== 'DESPESA') {
                        set({ accountId: e.target.value });
                        return;
                      }
                      const picked = decodeSource(e.target.value);
                      set({
                        sourceType: picked.source_type,
                        accountId: picked.source_id,
                        ...(picked.source_type === 'conta' ? { installments: '1' } : {}),
                      });
                    }}
                  />
                )}
              </Field>
              {transfer ? (
                <Field label="Destino" error={shown('toAccountId')}>
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
                <Field label="Valor (R$)" error={shown('amount')}>
                  {(props) => (
                    <MoneyInput
                      {...props}
                      symbol=""
                      invalid={shown('amount') !== undefined}
                      value={draft.amount}
                      onChange={(e) => set({ amount: e.target.value })}
                    />
                  )}
                </Field>
              )}
            </div>
            {draft.kind === 'DESPESA' ? (
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Parcelas"
                  error={shown('installments')}
                  hint={draft.sourceType === 'cartao' ? undefined : 'Só no cartão.'}
                >
                  {(props) => (
                    <Select
                      {...props}
                      invalid={shown('installments') !== undefined}
                      disabled={
                        draft.sourceType !== 'cartao' ||
                        draft.splitSource !== '' ||
                        editing !== undefined
                      }
                      options={INSTALLMENT_OPTIONS}
                      value={draft.installments}
                      onChange={(e) => set({ installments: e.target.value })}
                    />
                  )}
                </Field>
                <Field
                  label="Divisão"
                  error={shown('splitSource')}
                  hint={
                    draft.splitSource === ''
                      ? 'Opcional: parte em outra conta ou cartão.'
                      : undefined
                  }
                >
                  {(props) => (
                    <Select
                      {...props}
                      invalid={shown('splitSource') !== undefined}
                      placeholder="Não dividir"
                      options={payWith
                        .filter(
                          (option) =>
                            option.id !== `${draft.sourceType}:${draft.accountId}`,
                        )
                        .map((option) => ({
                          id: option.id,
                          name: `Dividir com ${option.name}`,
                        }))}
                      value={draft.splitSource}
                      onChange={(e) =>
                        set({
                          splitSource: e.target.value,
                          ...(e.target.value === ''
                            ? { splitAmount: '' }
                            : { installments: '1' }),
                        })
                      }
                    />
                  )}
                </Field>
              </div>
            ) : null}
            {draft.kind === 'DESPESA' && draft.splitSource !== '' ? (
              <Field
                label={`Parte em ${payWith.find((o) => o.id === draft.splitSource)?.name ?? 'outra origem'} (R$)`}
                error={shown('splitAmount')}
                hint="O resto sai da primeira origem."
              >
                {(props) => (
                  <MoneyInput
                    {...props}
                    symbol=""
                    invalid={shown('splitAmount') !== undefined}
                    value={draft.splitAmount}
                    onChange={(e) => set({ splitAmount: e.target.value })}
                  />
                )}
              </Field>
            ) : null}
            {transfer ? (
              <Field label="Descrição" error={shown('description')}>
                {(props) => (
                  <Input
                    {...props}
                    invalid={shown('description') !== undefined}
                    value={draft.description}
                    placeholder="Transferência entre contas"
                    onChange={(e) => set({ description: e.target.value })}
                  />
                )}
              </Field>
            ) : null}
            {isPlannable(draft.kind) ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {editing === undefined ? (
                    <Toggle
                      label="Repetir todo mês"
                      checked={draft.repeat}
                      disabled={draft.undated}
                      onChange={(repeat) => set({ repeat })}
                    />
                  ) : (
                    <span />
                  )}
                  <span className="text-[0.8125rem] text-ink-2">
                    Situação:{' '}
                    <span className="font-semibold text-ink">
                      {draft.undated
                        ? 'Previsto sem data'
                        : draft.planned
                          ? 'Previsto'
                          : 'Lançado'}
                    </span>
                  </span>
                </div>
                <NoteField value={draft.note} onChange={(note) => set({ note })} />
              </>
            ) : null}
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
        {notice === null ? null : <Callout tone="info">{notice}</Callout>}
      </FormShell>
    </Modal>
  );
};
