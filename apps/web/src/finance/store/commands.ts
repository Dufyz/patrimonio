import type { FinSnapshot } from '@patrimonio/domain';

import { centsToDecimal } from '../api/money_text.js';
import type { FinanceApi } from '../api/finance_api.js';
import type { RawSnapshot } from '../api/snapshot.js';
import * as accountOps from '../domain/account_ops.js';
import * as cardItemOps from '../domain/card_item_ops.js';
import * as cardOps from '../domain/card_ops.js';
import { invoiceTotal } from '../domain/cards.js';
import * as categoryOps from '../domain/category_ops.js';
import * as entryOps from '../domain/entry_ops.js';
import * as installmentOps from '../domain/installment_ops.js';
import * as invoiceOps from '../domain/invoice_ops.js';
import * as recurringOps from '../domain/recurring.js';
import * as transferOps from '../domain/transfer_ops.js';
import type { FinanceData, Payment } from '../domain/types.js';
import type { IsoDate } from '../lib/dates.js';
import { startOfMonth } from '../lib/dates.js';
import { parseMoneyInput } from '../lib/format.js';

/**
 * Cada ação das telas, em duas formas.
 *
 * `local` é a função pura de sempre, sobre `FinanceData`: é o que roda numa
 * store em memória (os testes). `remote` é a mesma intenção como chamadas à
 * API, que é a dona do dado. Depois de toda ação remota a store relê a foto, de
 * modo que o que a tela mostra é o que o servidor gravou, não o que o front
 * supôs. A validação das telas continua a mesma; a do servidor é a que vale.
 */

export type RemoteContext = {
  readonly api: FinanceApi;
  readonly data: FinanceData;
  readonly raw: RawSnapshot;
};

export type Command = {
  readonly local: (data: FinanceData) => FinanceData;
  readonly remote: (context: RemoteContext) => Promise<void>;
};

const command = (
  local: Command['local'],
  remote: (context: RemoteContext) => Promise<unknown>,
): Command => ({
  local,
  remote: async (context) => {
    await remote(context);
  },
});

type Scope = installmentOps.InstallmentScope;
const apiScope = (scope: Scope): 'esta' | 'seguintes' | 'todas' =>
  scope === 'futuras' ? 'seguintes' : scope;

const dec = (text: string): string => centsToDecimal(parseMoneyInput(text) ?? 0);
const sourceType = (data: FinanceData, id: string): 'conta' | 'cartao' =>
  data.cards.some((card) => card.id === id) ? 'cartao' : 'conta';
const sourceRef = (data: FinanceData, id: string) => ({
  type: sourceType(data, id),
  id,
});

const paymentBodies = (data: FinanceData, payments: readonly Payment[]) =>
  payments.map((payment) => ({
    source_type: sourceType(data, payment.sourceId),
    source_id: payment.sourceId,
    amount: centsToDecimal(payment.cents),
  }));

const entryBody = (data: FinanceData, draft: entryOps.EntryDraft) => ({
  kind: draft.kind,
  description: draft.description.trim(),
  date: draft.date,
  category_id: draft.categoryId,
  amount: dec(draft.value),
  payments: paymentBodies(data, entryOps.paymentsOf(draft)),
});

type RawEntry = FinSnapshot['entries'][number];
const bodyOfRaw = (entry: RawEntry) => ({
  kind: entry.kind,
  description: entry.description,
  date: entry.date,
  category_id: entry.category_id,
  amount: entry.amount,
  payments: entry.payments.map((p) => ({
    source_type: p.source_type,
    source_id: p.source_id,
    amount: p.amount,
  })),
  note: entry.note,
});
const inGroup = (entry: RawEntry) =>
  entry.installment === null ? {} : { scope: 'esta' };

const accountBody = (
  draft: accountOps.AccountDraft,
  today: IsoDate,
  previous?: FinSnapshot['accounts'][number],
) => {
  const role = draft.role.trim();
  return {
    name: draft.name.trim(),
    type: previous?.type ?? 'corrente',
    institution: previous?.institution ?? null,
    role,
    role_tag: previous !== undefined && previous.role === role ? previous.role_tag : null,
    opening_amount: dec(draft.initial),
    opening_date: previous?.opening_date ?? startOfMonth(today),
  };
};

const cardBody = (draft: cardOps.CardDraft) => ({
  name: draft.name.trim(),
  ...(draft.last4.trim() === '' ? {} : { last4: draft.last4.trim() }),
  pay_account_id: draft.payerId,
  limit_amount: dec(draft.limit),
  closing_day: Number(draft.closingDay),
  due_day: Number(draft.dueDay),
});

const recurringBody = (data: FinanceData, draft: recurringOps.RecurringDraft) => ({
  name: draft.name.trim(),
  kind: draft.kind,
  category_id: draft.categoryId,
  source: sourceRef(data, draft.sourceId),
  second_source: draft.split ? sourceRef(data, draft.secondSourceId) : null,
  covers_up_to: draft.split ? dec(draft.coversUpTo) : null,
  day: Number(draft.day),
  mode: draft.mode,
  amount: dec(draft.value),
  active: draft.active,
});

export const commands = {
  // ─── Lançamentos ───────────────────────────────────────────────────────────
  addEntry: (draft: entryOps.EntryDraft, today: IsoDate): Command =>
    command(
      (data) => entryOps.addEntry(data, draft, today),
      ({ api, data }) => {
        const count = entryOps.installmentCount(data, draft);
        return api.post('/entries', {
          ...entryBody(data, draft),
          ...(count > 1 ? { installments: count } : {}),
        });
      },
    ),

  updateEntry: (id: string, draft: entryOps.EntryDraft, today: IsoDate): Command =>
    command(
      (data) => entryOps.updateEntry(data, id, draft, today),
      ({ api, data }) => api.put(`/entries/${id}`, entryBody(data, draft)),
    ),

  launchEntry: (id: string, draft: entryOps.EntryDraft, today: IsoDate): Command =>
    command(
      (data) => entryOps.launchEntry(data, id, draft, today),
      ({ api, data }) =>
        api.post(`/entries/${id}/confirm`, {
          date: draft.date,
          amount: dec(draft.value),
          payments: paymentBodies(data, entryOps.paymentsOf(draft)),
        }),
    ),

  deleteEntries: (ids: readonly string[]): Command =>
    command(
      (data) => entryOps.deleteEntries(data, ids),
      async ({ api, raw }) => {
        for (const id of ids) {
          const entry = raw.entries.find((e) => e.id === id);
          await api.del(`/entries/${id}${entry?.installment ? '?scope=esta' : ''}`);
        }
      },
    ),

  recategorize: (ids: readonly string[], categoryId: string): Command =>
    command(
      (data) => entryOps.recategorize(data, ids, categoryId),
      async ({ api, raw }) => {
        const category = raw.categories.find((c) => c.id === categoryId);
        for (const entry of raw.entries) {
          if (!ids.includes(entry.id) || entry.status !== 'lancada') continue;
          if (entry.kind !== category?.kind || entry.category_id === categoryId) continue;
          await api.put(`/entries/${entry.id}`, {
            ...bodyOfRaw(entry),
            category_id: categoryId,
            ...inGroup(entry),
          });
        }
      },
    ),

  moveAccount: (ids: readonly string[], sourceId: string): Command =>
    command(
      (data) => entryOps.moveAccount(data, ids, sourceId),
      async ({ api, raw }) => {
        for (const entry of raw.entries.filter((e) => ids.includes(e.id))) {
          await api.put(`/entries/${entry.id}`, {
            ...bodyOfRaw(entry),
            payments: [
              { source_type: 'conta', source_id: sourceId, amount: entry.amount },
            ],
            ...inGroup(entry),
          });
        }
      },
    ),

  // ─── Parcelas ──────────────────────────────────────────────────────────────
  deleteInstallments: (origin: 'entry' | 'item', id: string, scope: Scope): Command =>
    command(
      (data) => installmentOps.deleteInstallments(data, origin, id, scope),
      async ({ api, data }) => {
        if (origin === 'entry') {
          await api.del(`/entries/${id}?scope=${apiScope(scope)}`);
          return;
        }
        for (const item of installmentOps.itemTargets(data, id, scope)) {
          await api.del(`/card-items/${item.id}`);
        }
      },
    ),

  updateInstallmentEntries: (
    id: string,
    draft: entryOps.EntryDraft,
    scope: Scope,
  ): Command =>
    command(
      (data) => installmentOps.updateInstallmentEntries(data, id, draft, scope),
      ({ api, data }) =>
        api.put(`/entries/${id}`, {
          ...entryBody(data, draft),
          scope: apiScope(scope),
        }),
    ),

  updateInstallmentItems: (
    id: string,
    draft: cardItemOps.CardItemDraft,
    scope: Scope,
  ): Command =>
    command(
      (data) => installmentOps.updateInstallmentItems(data, id, draft, scope),
      () => {
        throw new Error('Parcelas só da fatura ainda não se editam pela API.');
      },
    ),

  // ─── Itens, pagamento e cartões ────────────────────────────────────────────
  updateCardItem: (id: string, draft: cardItemOps.CardItemDraft): Command =>
    command(
      (data) => cardItemOps.updateCardItem(data, id, draft),
      async ({ api, data }) => {
        const item = data.cardItems.find((i) => i.id === id);
        if (item === undefined || item.kind === 'compra' || item.subtype === undefined) {
          throw new Error('Este item da fatura não se edita pela API.');
        }
        await api.del(`/card-items/${id}`);
        await api.post(`/cards/${item.cardId}/items`, {
          kind: item.kind,
          subtype: item.subtype,
          invoice_month: item.invoice ?? '',
          description: draft.description.trim(),
          amount: dec(draft.value),
          date: draft.date,
          ...(draft.categoryId === '' ? {} : { category_id: draft.categoryId }),
        });
      },
    ),

  deleteCardItem: (id: string): Command =>
    command(
      (data) => cardItemOps.deleteCardItem(data, id),
      ({ api }) => api.del(`/card-items/${id}`),
    ),

  addCredit: (cardId: string, invoice: string, draft: cardItemOps.CreditDraft): Command =>
    command(
      (data) => cardItemOps.addCredit(data, cardId, invoice, draft),
      ({ api }) =>
        api.post(`/cards/${cardId}/items`, {
          kind: 'credito',
          subtype: draft.subtype,
          invoice_month: invoice,
          description: draft.description.trim(),
          amount: dec(draft.value),
          date: draft.date,
          category_id: draft.categoryId,
          ...(draft.reversesId === undefined ? {} : { reverses_id: draft.reversesId }),
        }),
    ),

  moveToInvoice: (
    origin: 'entry' | 'item',
    id: string,
    cardId: string,
    month: string,
  ): Command =>
    command(
      (data) => cardItemOps.moveToInvoice(data, origin, id, cardId, month),
      ({ api }) =>
        api.post(
          origin === 'entry' ? `/entries/${id}/invoice` : `/card-items/${id}/invoice`,
          {
            invoice_month: month,
          },
        ),
    ),

  addCharge: (cardId: string, invoice: string, draft: cardItemOps.ChargeDraft): Command =>
    command(
      (data) => cardItemOps.addCharge(data, cardId, invoice, draft),
      ({ api }) =>
        api.post(`/cards/${cardId}/items`, {
          kind: 'encargo',
          subtype: draft.subtype,
          invoice_month: invoice,
          description:
            cardItemOps.CHARGE_TYPES.find((t) => t.id === draft.subtype)?.name ??
            draft.subtype,
          amount: dec(draft.value),
          date: draft.date,
          category_id: draft.categoryId,
        }),
    ),

  payInvoice: (cardId: string, key: string, date: IsoDate, today: IsoDate): Command =>
    command(
      (data) => invoiceOps.payInvoice(data, cardId, key, date, today),
      ({ api, data }) => {
        const card = data.cards.find((c) => c.id === cardId);
        if (card === undefined) throw new Error('Cartão não encontrado.');
        return api.post(`/cards/${cardId}/invoices/${key}/payments`, {
          date,
          amount: centsToDecimal(invoiceTotal(data, card, key)),
        });
      },
    ),

  addCard: (draft: cardOps.CardDraft): Command =>
    command(
      (data) => cardOps.addCard(data, draft),
      ({ api }) => api.post('/cards', cardBody(draft)),
    ),

  updateCard: (id: string, draft: cardOps.CardDraft): Command =>
    command(
      (data) => cardOps.updateCard(data, id, draft),
      ({ api }) => api.put(`/cards/${id}`, cardBody(draft)),
    ),

  // ─── Contas e transferências ───────────────────────────────────────────────
  addAccount: (draft: accountOps.AccountDraft, today: IsoDate): Command =>
    command(
      (data) => accountOps.addAccount(data, draft),
      ({ api }) => api.post('/accounts', accountBody(draft, today)),
    ),

  updateAccount: (id: string, draft: accountOps.AccountDraft, today: IsoDate): Command =>
    command(
      (data) => accountOps.updateAccount(data, id, draft),
      ({ api, raw }) =>
        api.put(
          `/accounts/${id}`,
          accountBody(
            draft,
            today,
            raw.accounts.find((a) => a.id === id),
          ),
        ),
    ),

  archiveAccount: (id: string, today: IsoDate, confirmedBalance = false): Command =>
    command(
      (data) => accountOps.archiveAccount(data, id, today, confirmedBalance),
      ({ api }) => api.post(`/accounts/${id}/archive`, { archived: true }),
    ),

  restoreAccount: (id: string): Command =>
    command(
      (data) => accountOps.restoreAccount(data, id),
      ({ api }) => api.post(`/accounts/${id}/archive`, { archived: false }),
    ),

  addTransfer: (draft: transferOps.TransferDraft, today: IsoDate): Command =>
    command(
      (data) => transferOps.addTransfer(data, draft, today),
      ({ api }) => {
        const note = draft.description.trim();
        return api.post('/transfers', {
          from_account_id: draft.fromId,
          to_account_id: draft.toId,
          amount: dec(draft.value),
          date: draft.date,
          ...(note === '' ? {} : { note }),
        });
      },
    ),

  // ─── Recorrentes ───────────────────────────────────────────────────────────
  addRecurring: (draft: recurringOps.RecurringDraft, today: IsoDate): Command =>
    command(
      (data) => recurringOps.addRecurring(data, draft, today),
      ({ api, data }) => api.post('/recurrings', recurringBody(data, draft)),
    ),

  updateRecurring: (
    id: string,
    draft: recurringOps.RecurringDraft,
    today: IsoDate,
  ): Command =>
    command(
      (data) => recurringOps.updateRecurring(data, id, draft, today),
      ({ api, data }) => api.put(`/recurrings/${id}`, recurringBody(data, draft)),
    ),

  setRecurringActive: (id: string, active: boolean, today: IsoDate): Command =>
    command(
      (data) => recurringOps.setRecurringActive(data, id, active, today),
      ({ api }) => api.post(`/recurrings/${id}/active`, { active }),
    ),

  deleteRecurring: (id: string): Command =>
    command(
      (data) => recurringOps.deleteRecurring(data, id),
      ({ api }) => api.del(`/recurrings/${id}`),
    ),

  // ─── Categorias ────────────────────────────────────────────────────────────
  addCategory: (draft: categoryOps.CategoryDraft): Command =>
    command(
      (data) => categoryOps.addCategory(data, draft),
      ({ api }) =>
        api.post('/categories', {
          name: draft.name.trim(),
          kind: draft.kind,
          color: draft.color,
        }),
    ),

  updateCategory: (id: string, draft: categoryOps.CategoryDraft): Command =>
    command(
      (data) => categoryOps.updateCategory(data, id, draft),
      ({ api }) =>
        api.put(`/categories/${id}`, {
          name: draft.name.trim(),
          kind: draft.kind,
          color: draft.color,
        }),
    ),

  /** RN-61: os lançamentos e recorrentes da categoria passam para a escolhida, depois ela sai. */
  deleteCategory: (id: string, replacementId: string | null): Command =>
    command(
      (data) => categoryOps.deleteCategory(data, id, replacementId),
      async ({ api, raw }) => {
        if (replacementId !== null) {
          for (const entry of raw.entries.filter((e) => e.category_id === id)) {
            await api.put(`/entries/${entry.id}`, {
              ...bodyOfRaw(entry),
              category_id: replacementId,
              ...inGroup(entry),
            });
          }
          for (const r of raw.recurrings.filter((x) => x.category_id === id)) {
            await api.put(`/recurrings/${r.id}`, {
              name: r.name,
              kind: r.kind,
              category_id: replacementId,
              source: r.source,
              second_source: r.second_source,
              covers_up_to: r.covers_up_to,
              day: r.day,
              mode: r.mode,
              amount: r.amount,
              active: r.active,
            });
          }
        }
        await api.del(`/categories/${id}`);
      },
    ),
};
