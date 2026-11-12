import type { FinCard, FinCardItem, FinEntry, FinSnapshot } from '@patrimonio/domain';

import {
  addDays,
  addMonths,
  compareDates,
  dateInMonth,
  diffDays,
  monthKey,
  monthStart,
  shiftMonthKey,
  startOfMonth,
} from './dates.js';
import { dec, max, money, total, ZERO } from './money.js';
import { findCard } from './lookup.js';
import type { Decimal } from 'decimal.js';

/**
 * Faturas de cartão (RN-40 a RN-53). A fatura é identificada pelo mês de
 * vencimento (`AAAA-MM`); o período de compras vai do dia seguinte ao fechamento
 * anterior até o dia de fechamento. Não há tabela de fatura: ela é derivada das
 * partes de cartão dos lançamentos e dos itens que só a fatura tem.
 */

export type InvoiceStatus = 'prevista' | 'aberta' | 'fechada' | 'parcial' | 'paga';

/** O dia de fechamento da fatura `key`: se vence antes de fechar, fechou no mês anterior. */
export const invoiceClosing = (card: FinCard, key: string): string => {
  const base =
    card.due_day < card.closing_day ? addMonths(monthStart(key), -1) : monthStart(key);
  return dateInMonth(base, card.closing_day);
};

export const invoiceDue = (card: FinCard, key: string): string =>
  dateInMonth(monthStart(key), card.due_day);

/** Primeiro e último dia de compras da fatura. */
export const invoicePeriod = (
  card: FinCard,
  key: string,
): { from: string; to: string } => {
  const to = invoiceClosing(card, key);
  const previous = invoiceClosing(card, shiftMonthKey(key, -1));
  return { from: addDays(previous, 1), to };
};

/** RN-42: até o dia de fechamento entra na fatura que fecha no mês; depois, na seguinte. */
export const invoiceKeyOf = (card: FinCard, date: string): string => {
  const closing = dateInMonth(date, card.closing_day);
  const closingMonth =
    compareDates(date, closing) <= 0
      ? startOfMonth(date)
      : addMonths(startOfMonth(date), 1);
  return monthKey(
    card.due_day < card.closing_day ? addMonths(closingMonth, 1) : closingMonth,
  );
};

export type InvoiceBlock = 'compras' | 'parcelas' | 'creditos' | 'encargos';

export type InvoiceLine = {
  readonly id: string;
  /** `entry` vem de Lançamentos; `item` só existe na fatura (RN-46). */
  readonly origin: 'entry' | 'item';
  readonly block: InvoiceBlock;
  /** Data exibida: a da compra original nas parcelas. */
  readonly date: string;
  readonly description: string;
  readonly category_id: string | null;
  /** Sempre positivo; o bloco diz se soma ou abate. */
  readonly amount: string;
  readonly installment: { readonly no: number; readonly total: number } | null;
  readonly subtype: string | null;
  readonly forecast: boolean;
};

const entryInvoice = (
  card: FinCard,
  entry: FinEntry,
  paymentMonth: string | null,
): string => paymentMonth ?? invoiceKeyOf(card, entry.date);

/** A parte do lançamento que o cartão cobre, e a fatura em que ela caiu. */
const cardParts = (
  card: FinCard,
  entry: FinEntry,
): readonly { amount: Decimal; key: string }[] =>
  entry.payments
    .filter(
      (payment) => payment.source_type === 'cartao' && payment.source_id === card.id,
    )
    .map((payment) => ({
      amount: dec(payment.amount),
      key: entryInvoice(card, entry, payment.invoice_month),
    }));

const entryLine = (entry: FinEntry, amount: Decimal): InvoiceLine => ({
  id: entry.id,
  origin: 'entry',
  block:
    entry.installment === null || entry.installment.no === 1 ? 'compras' : 'parcelas',
  date: entry.installment?.origin ?? entry.date,
  description: entry.description,
  category_id: entry.category_id,
  amount: money(amount),
  installment:
    entry.installment === null
      ? null
      : { no: entry.installment.no, total: entry.installment.total },
  subtype: null,
  forecast: entry.status === 'prevista',
});

const itemLine = (item: FinCardItem): InvoiceLine => ({
  id: item.id,
  origin: 'item',
  block:
    item.kind === 'credito'
      ? 'creditos'
      : item.kind === 'encargo'
        ? 'encargos'
        : item.installment === null || item.installment.no === 1
          ? 'compras'
          : 'parcelas',
  date: item.installment?.origin ?? item.purchase_date,
  description: item.description,
  category_id: item.category_id,
  amount: item.amount,
  installment:
    item.installment === null
      ? null
      : { no: item.installment.no, total: item.installment.total },
  subtype: item.subtype,
  forecast: false,
});

const byDate = (a: InvoiceLine, b: InvoiceLine): number =>
  compareDates(b.date, a.date) || a.description.localeCompare(b.description, 'pt-BR');

/** As linhas da fatura `key`: despesas pagas no cartão e itens que só a fatura tem. */
export const invoiceLines = (
  data: FinSnapshot,
  card: FinCard,
  key: string,
): readonly InvoiceLine[] => {
  const lines: InvoiceLine[] = [];
  for (const entry of data.entries) {
    if (entry.kind !== 'despesa') continue;
    const amount = total(
      cardParts(card, entry)
        .filter((p) => p.key === key)
        .map((p) => p.amount),
    );
    if (amount.gt(0)) lines.push(entryLine(entry, amount));
  }
  for (const item of data.card_items) {
    if (item.card_id === card.id && item.invoice_month === key)
      lines.push(itemLine(item));
  }
  return lines.sort(byDate);
};

export type InvoiceTotals = {
  readonly compras: string;
  readonly parcelas: string;
  readonly creditos: string;
  readonly encargos: string;
  /** RN-44: compras + parcelas − créditos + encargos, nunca abaixo de zero. */
  readonly total: string;
};

export const invoiceTotals = (lines: readonly InvoiceLine[]): InvoiceTotals => {
  const sum = (block: InvoiceBlock): Decimal =>
    total(lines.filter((line) => line.block === block).map((line) => dec(line.amount)));
  const compras = sum('compras');
  const parcelas = sum('parcelas');
  const creditos = sum('creditos');
  const encargos = sum('encargos');
  return {
    compras: money(compras),
    parcelas: money(parcelas),
    creditos: money(creditos),
    encargos: money(encargos),
    total: money(max(ZERO, compras.plus(parcelas).minus(creditos).plus(encargos))),
  };
};

export const invoiceTotal = (data: FinSnapshot, card: FinCard, key: string): Decimal =>
  dec(invoiceTotals(invoiceLines(data, card, key)).total);

/** O quanto da fatura já foi pago (RN-50 permite pagamento parcial). */
export const invoicePaid = (data: FinSnapshot, cardId: string, key: string): Decimal =>
  total(
    data.invoice_payments
      .filter((payment) => payment.card_id === cardId && payment.invoice_month === key)
      .map((payment) => dec(payment.amount)),
  );

/** O que falta pagar: o total menos o pago, nunca abaixo de zero. */
export const invoiceRemaining = (
  data: FinSnapshot,
  card: FinCard,
  key: string,
): Decimal =>
  max(ZERO, invoiceTotal(data, card, key).minus(invoicePaid(data, card.id, key)));

export const invoiceStatus = (
  data: FinSnapshot,
  card: FinCard,
  key: string,
  today: string,
): InvoiceStatus => {
  const paid = invoicePaid(data, card.id, key);
  if (paid.gt(0)) return invoiceRemaining(data, card, key).lte(0) ? 'paga' : 'parcial';
  const { from, to } = invoicePeriod(card, key);
  if (compareDates(today, to) > 0) return 'fechada';
  return compareDates(today, from) >= 0 ? 'aberta' : 'prevista';
};

export type InvoiceSummary = {
  readonly month: string;
  readonly status: InvoiceStatus;
  readonly total: string;
  readonly paid: string;
  readonly remaining: string;
  readonly closing: string;
  readonly due: string;
  /** Fechada que passou do vencimento sem quitar (FIN-511). */
  readonly overdue: boolean;
};

export const invoiceSummary = (
  data: FinSnapshot,
  card: FinCard,
  key: string,
  today: string,
): InvoiceSummary => {
  const status = invoiceStatus(data, card, key, today);
  const due = invoiceDue(card, key);
  return {
    month: key,
    status,
    total: money(invoiceTotal(data, card, key)),
    paid: money(invoicePaid(data, card.id, key)),
    remaining: money(invoiceRemaining(data, card, key)),
    closing: invoiceClosing(card, key),
    due,
    overdue:
      (status === 'fechada' || status === 'parcial') && compareDates(today, due) > 0,
  };
};

/** Todas as faturas com movimento, da mais antiga à última prevista (RN-43). */
export const cardInvoiceKeys = (
  data: FinSnapshot,
  card: FinCard,
  today: string,
): readonly string[] => {
  const keys = new Set<string>([invoiceKeyOf(card, today)]);
  for (const entry of data.entries) {
    if (entry.kind !== 'despesa') continue;
    for (const part of cardParts(card, entry)) keys.add(part.key);
  }
  for (const item of data.card_items)
    if (item.card_id === card.id) keys.add(item.invoice_month);
  for (const payment of data.invoice_payments) {
    if (payment.card_id === card.id) keys.add(payment.invoice_month);
  }
  return [...keys].sort();
};

/** RN-47: a fatura fechada mais antiga a pagar, ou a aberta se não houver fechada. */
export const vigenteKey = (data: FinSnapshot, card: FinCard, today: string): string => {
  const open = invoiceKeyOf(card, today);
  const closed = cardInvoiceKeys(data, card, today).filter(
    (key) =>
      key < open &&
      ['fechada', 'parcial'].includes(invoiceStatus(data, card, key, today)) &&
      invoiceRemaining(data, card, key).gt(0),
  );
  return closed[0] ?? open;
};

export type CardSummary = {
  readonly card: FinCard;
  readonly invoice: InvoiceSummary;
  /** O que está em aberto na fatura vigente. */
  readonly used: string;
  readonly used_percent: number;
  readonly available: string;
  readonly days_to_due: number;
};

export const cardSummary = (
  data: FinSnapshot,
  card: FinCard,
  today: string,
): CardSummary => {
  const invoice = invoiceSummary(data, card, vigenteKey(data, card, today), today);
  const used = dec(invoice.remaining);
  const limit = dec(card.limit_amount);
  return {
    card,
    invoice,
    used: money(used),
    used_percent: limit.gt(0)
      ? used.times(1000).div(limit).toDecimalPlaces(0).div(10).toNumber()
      : 0,
    available: money(limit.minus(used)),
    days_to_due: diffDays(today, invoice.due),
  };
};

export const activeCards = (data: FinSnapshot): readonly FinCard[] =>
  data.cards.filter((card) => !card.archived);

/** RN-48: soma das faturas vigentes em aberto dos cartões ativos. */
export const openInvoicesTotal = (data: FinSnapshot, today: string): Decimal =>
  total(activeCards(data).map((card) => dec(cardSummary(data, card, today).used)));

export type UpcomingCell = { readonly card_id: string; readonly amount: string | null };

export type UpcomingRow = {
  readonly month: string;
  readonly status: Exclude<InvoiceStatus, 'paga' | 'parcial'> | 'parcial';
  readonly cells: readonly UpcomingCell[];
  readonly total: string;
};

/** As faturas a pagar, da vigente em diante, uma coluna por cartão. */
export const upcomingInvoices = (
  data: FinSnapshot,
  today: string,
): readonly UpcomingRow[] => {
  const cards = activeCards(data);
  if (cards.length === 0) return [];
  const first = cards.map((card) => vigenteKey(data, card, today)).sort()[0] ?? '';
  const last = cards
    .flatMap((card) => cardInvoiceKeys(data, card, today))
    .sort()
    .pop();
  if (last === undefined) return [];

  const rows: UpcomingRow[] = [];
  for (let key = first; key <= last; key = shiftMonthKey(key, 1)) {
    const cells = cards.map((card): UpcomingCell => {
      const remaining = invoiceRemaining(data, card, key);
      return { card_id: card.id, amount: remaining.gt(0) ? money(remaining) : null };
    });
    const statuses = cards
      .filter((_, index) => cells[index]?.amount !== null)
      .map((card) => invoiceStatus(data, card, key, today));
    const status = statuses.includes('fechada')
      ? 'fechada'
      : statuses.includes('parcial')
        ? 'parcial'
        : statuses.includes('aberta')
          ? 'aberta'
          : 'prevista';
    rows.push({
      month: key,
      status,
      cells,
      total: money(total(cells.map((cell) => dec(cell.amount ?? '0')))),
    });
  }
  return rows;
};

export { findCard };
