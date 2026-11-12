import type { FinSnapshot } from '@patrimonio/domain';

import type {
  Account,
  Card,
  CardItem,
  ChargeType,
  CreditType,
  Entry,
  FinanceData,
  InvoicePayment,
  Movement,
  Recurring,
} from '../domain/types.js';
import { decimalToCents } from './money_text.js';

/**
 * Da foto da API para o modelo que as telas leem.
 *
 * As telas continuam calculando a partir de `FinanceData` (centavos inteiros,
 * `sourceId` único); a API manda texto decimal e origem com tipo. Esta função é
 * a única que conhece as duas formas.
 */

export type RawSnapshot = FinSnapshot & { readonly today: string };

const installmentOf = (
  value: { readonly no: number; readonly total: number; readonly origin: string } | null,
): { n: number; of: number; origin: string } | undefined =>
  value === null ? undefined : { n: value.no, of: value.total, origin: value.origin };

const account = (a: FinSnapshot['accounts'][number]): Account => ({
  id: a.id,
  name: a.name,
  role: a.role,
  ...(a.role_tag === null ? {} : { roleTag: a.role_tag }),
  ...(a.institution === null ? {} : { institution: a.institution }),
  type: 'conta',
  initialCents: decimalToCents(a.opening_amount),
  ...(a.archived ? { archived: true } : {}),
  openedOn: a.opening_date,
});

const card = (c: FinSnapshot['cards'][number]): Card => ({
  id: c.id,
  name: c.name,
  last4: c.last4,
  payerId: c.pay_account_id,
  limitCents: decimalToCents(c.limit_amount),
  closingDay: c.closing_day,
  dueDay: c.due_day,
});

type RawRecurring = FinSnapshot['recurrings'][number];
type EntryRawRecurring = RawRecurring & {
  kind: 'receita' | 'despesa';
  category_id: string;
};

const isEntryRecurring = (r: RawRecurring): r is EntryRawRecurring =>
  r.kind !== 'aporte' && r.category_id !== null;

const recurring = (r: EntryRawRecurring): Recurring => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  categoryId: r.category_id,
  sourceId: r.source.id,
  ...(r.second_source === null ? {} : { secondSourceId: r.second_source.id }),
  ...(r.covers_up_to === null ? {} : { coversUpTo: decimalToCents(r.covers_up_to) }),
  day: r.day,
  mode: r.mode === 'automatico' ? 'automatico' : 'manual',
  cents: decimalToCents(r.amount),
  active: r.active,
});

const entry = (e: FinSnapshot['entries'][number]): Entry => {
  const installment = installmentOf(e.installment);
  return {
    id: e.id,
    kind: e.kind,
    date: e.date,
    description: e.description,
    categoryId: e.category_id,
    cents: decimalToCents(e.amount),
    status: e.status,
    ...(e.recurring_id === null ? {} : { recurringId: e.recurring_id }),
    ...(installment === undefined ? {} : { installment }),
    payments: e.payments.map((p) => ({
      sourceId: p.source_id,
      cents: decimalToCents(p.amount),
      ...(p.invoice_month === null || p.invoice_month === undefined
        ? {}
        : { invoice: p.invoice_month }),
    })),
  };
};

const movement = (m: FinSnapshot['movements'][number]): Movement => ({
  id: m.id,
  date: m.date,
  accountId: m.account_id,
  kind: m.kind === 'ajuste' ? 'ajuste' : 'transferencia',
  cents: decimalToCents(m.amount),
  description: m.description,
  ...(m.note === null ? {} : { note: m.note }),
  ...(m.transfer_id === null ? {} : { transferId: m.transfer_id }),
});

const cardItem = (i: FinSnapshot['card_items'][number]): CardItem => {
  const installment = installmentOf(i.installment);
  return {
    id: i.id,
    cardId: i.card_id,
    kind: i.kind,
    date: i.purchase_date,
    description: i.description,
    ...(i.category_id === null ? {} : { categoryId: i.category_id }),
    cents: decimalToCents(i.amount),
    ...(i.subtype === null ? {} : { subtype: i.subtype as CreditType | ChargeType }),
    ...(installment === undefined ? {} : { installment }),
    invoice: i.invoice_month,
    ...(i.reverses_id === null || i.reverses_id === undefined
      ? {}
      : { reversesId: i.reverses_id }),
  };
};

const payment = (p: FinSnapshot['invoice_payments'][number]): InvoicePayment => ({
  id: p.id,
  cardId: p.card_id,
  invoice: p.invoice_month,
  date: p.date,
  accountId: p.account_id,
  cents: decimalToCents(p.amount),
  ...(p.posted ? {} : { posted: false }),
});

export const snapshotToData = (raw: FinSnapshot): FinanceData => ({
  categories: raw.categories.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    color: c.color,
  })),
  accounts: raw.accounts.map(account),
  cards: raw.cards.filter((c) => !c.archived).map(card),
  // O aporte recorrente (LIV-11) ganha tela própria em Recorrentes; aqui só entram os de lançamento.
  recurrings: raw.recurrings.filter(isEntryRecurring).map(recurring),
  entries: raw.entries.map(entry),
  movements: raw.movements.map(movement),
  cardItems: raw.card_items.map(cardItem),
  payments: raw.invoice_payments.map(payment),
  skips: raw.skips.map((s) => `${s.recurring_id}:${s.month}`),
});

export const EMPTY_DATA: FinanceData = {
  categories: [],
  accounts: [],
  cards: [],
  recurrings: [],
  entries: [],
  movements: [],
  cardItems: [],
  payments: [],
  skips: [],
};
