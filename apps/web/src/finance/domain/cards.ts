import {
  addDays,
  addMonths,
  compareDates,
  diffDays,
  monthKey,
  startOfMonth,
} from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { usedPercent } from '../lib/limit.js';
import type { Cents } from '../lib/money.js';
import { dateInMonth } from './recurring.js';
import type { Card, CardItem, Entry, FinanceData, InvoicePayment } from './types.js';

/**
 * Faturas de cartão (RN-40 a RN-53). A fatura é identificada pelo mês de
 * vencimento (`AAAA-MM`); o período de compras vai do dia seguinte ao fechamento
 * anterior até o dia de fechamento.
 */

export type InvoiceStatus = 'prevista' | 'aberta' | 'fechada' | 'paga';

export const findCard = (data: FinanceData, id: string): Card | undefined =>
  data.cards.find((card) => card.id === id);

const monthStart = (key: string): IsoDate => `${key}-01`;

/** O dia de fechamento da fatura `key`: se vence antes de fechar, fechou no mês anterior. */
export const invoiceClosing = (card: Card, key: string): IsoDate => {
  const base =
    card.dueDay < card.closingDay ? addMonths(monthStart(key), -1) : monthStart(key);
  return dateInMonth(base, card.closingDay);
};

export const invoiceDue = (card: Card, key: string): IsoDate =>
  dateInMonth(monthStart(key), card.dueDay);

/** Primeiro e último dia de compras da fatura. */
export const invoicePeriod = (
  card: Card,
  key: string,
): { from: IsoDate; to: IsoDate } => {
  const to = invoiceClosing(card, key);
  const previous = invoiceClosing(card, monthKey(addMonths(monthStart(key), -1)));
  return { from: addDays(previous, 1), to };
};

/** RN-42: até o dia de fechamento entra na fatura que fecha no mês; depois, na seguinte. */
export const invoiceKeyOf = (card: Card, date: IsoDate): string => {
  const closing = dateInMonth(date, card.closingDay);
  const closingMonth =
    compareDates(date, closing) <= 0
      ? startOfMonth(date)
      : addMonths(startOfMonth(date), 1);
  return monthKey(
    card.dueDay < card.closingDay ? addMonths(closingMonth, 1) : closingMonth,
  );
};

export const shiftInvoice = (key: string, months: number): string =>
  monthKey(addMonths(monthStart(key), months));

export const paymentOf = (
  data: FinanceData,
  cardId: string,
  key: string,
): InvoicePayment | undefined =>
  data.payments.find((payment) => payment.cardId === cardId && payment.invoice === key);

export const invoiceStatus = (
  data: FinanceData,
  card: Card,
  key: string,
  today: IsoDate,
): InvoiceStatus => {
  if (paymentOf(data, card.id, key) !== undefined) return 'paga';
  const { from, to } = invoicePeriod(card, key);
  if (compareDates(today, to) > 0) return 'fechada';
  return compareDates(today, from) >= 0 ? 'aberta' : 'prevista';
};

export type InvoiceBlock = 'compras' | 'parcelas' | 'creditos' | 'encargos';

export type InvoiceLine = {
  readonly id: string;
  /** `entry` vem de Lançamentos; `item` só existe na fatura (RN-46). */
  readonly origin: 'entry' | 'item';
  readonly block: InvoiceBlock;
  /** Data exibida: a da compra original nas parcelas. */
  readonly date: IsoDate;
  readonly description: string;
  readonly categoryId: string | undefined;
  /** Sempre positivo; o bloco diz se soma ou abate. */
  readonly cents: Cents;
  readonly installment: { readonly n: number; readonly of: number } | undefined;
  readonly subtype: string | undefined;
  readonly forecast: boolean;
};

const entryLine = (entry: Entry, cents: Cents): InvoiceLine => ({
  id: entry.id,
  origin: 'entry',
  block:
    entry.installment === undefined || entry.installment.n === 1 ? 'compras' : 'parcelas',
  date: entry.installment?.origin ?? entry.date,
  description: entry.description,
  categoryId: entry.categoryId,
  cents,
  installment:
    entry.installment === undefined
      ? undefined
      : { n: entry.installment.n, of: entry.installment.of },
  subtype: undefined,
  forecast: entry.status === 'prevista',
});

const itemLine = (item: CardItem): InvoiceLine => ({
  id: item.id,
  origin: 'item',
  block:
    item.kind === 'credito'
      ? 'creditos'
      : item.kind === 'encargo'
        ? 'encargos'
        : item.installment === undefined || item.installment.n === 1
          ? 'compras'
          : 'parcelas',
  date: item.installment?.origin ?? item.date,
  description: item.description,
  categoryId: item.categoryId,
  cents: item.cents,
  installment:
    item.installment === undefined
      ? undefined
      : { n: item.installment.n, of: item.installment.of },
  subtype: item.subtype,
  forecast: false,
});

const itemKey = (card: Card, item: CardItem): string =>
  item.invoice ?? invoiceKeyOf(card, item.date);

const byDate = (a: InvoiceLine, b: InvoiceLine): number =>
  compareDates(b.date, a.date) || a.description.localeCompare(b.description, 'pt-BR');

/** As linhas da fatura `key`: despesas pagas no cartão e itens que só a fatura tem. */
export const invoiceLines = (
  data: FinanceData,
  card: Card,
  key: string,
): readonly InvoiceLine[] => {
  const lines: InvoiceLine[] = [];
  for (const entry of data.entries) {
    if (entry.kind !== 'despesa' || entry.historical === true) continue;
    if (invoiceKeyOf(card, entry.date) !== key) continue;
    const cents = entry.payments
      .filter((payment) => payment.sourceId === card.id)
      .reduce((sum, payment) => sum + payment.cents, 0);
    if (cents > 0) lines.push(entryLine(entry, cents));
  }
  for (const item of data.cardItems) {
    if (item.cardId === card.id && itemKey(card, item) === key)
      lines.push(itemLine(item));
  }
  return lines.sort(byDate);
};

export type InvoiceTotals = {
  readonly compras: Cents;
  readonly parcelas: Cents;
  readonly creditos: Cents;
  readonly encargos: Cents;
  /** RN-44: compras + parcelas − créditos + encargos. */
  readonly total: Cents;
};

export const invoiceTotals = (lines: readonly InvoiceLine[]): InvoiceTotals => {
  const sum = (block: InvoiceBlock): Cents =>
    lines
      .filter((line) => line.block === block)
      .reduce((acc, line) => acc + line.cents, 0);
  const compras = sum('compras');
  const parcelas = sum('parcelas');
  const creditos = sum('creditos');
  const encargos = sum('encargos');
  return {
    compras,
    parcelas,
    creditos,
    encargos,
    total: compras + parcelas - creditos + encargos,
  };
};

export const invoiceTotal = (data: FinanceData, card: Card, key: string): Cents =>
  invoiceTotals(invoiceLines(data, card, key)).total;

export type InvoiceSummary = {
  readonly key: string;
  readonly status: InvoiceStatus;
  readonly total: Cents;
  readonly closing: IsoDate;
  readonly due: IsoDate;
};

export const invoiceSummary = (
  data: FinanceData,
  card: Card,
  key: string,
  today: IsoDate,
): InvoiceSummary => ({
  key,
  status: invoiceStatus(data, card, key, today),
  total: invoiceTotal(data, card, key),
  closing: invoiceClosing(card, key),
  due: invoiceDue(card, key),
});

/** Todas as faturas com movimento, da mais antiga à última prevista (RN-43). */
export const cardInvoiceKeys = (
  data: FinanceData,
  card: Card,
  today: IsoDate,
): readonly string[] => {
  const keys = new Set<string>([invoiceKeyOf(card, today)]);
  for (const entry of data.entries) {
    if (
      entry.kind === 'despesa' &&
      entry.historical !== true &&
      entry.payments.some((p) => p.sourceId === card.id)
    ) {
      keys.add(invoiceKeyOf(card, entry.date));
    }
  }
  for (const item of data.cardItems)
    if (item.cardId === card.id) keys.add(itemKey(card, item));
  for (const payment of data.payments)
    if (payment.cardId === card.id) keys.add(payment.invoice);
  return [...keys].sort();
};

/** RN-47: a fatura fechada mais antiga a pagar, ou a aberta se não houver fechada. */
export const vigenteKey = (data: FinanceData, card: Card, today: IsoDate): string => {
  const open = invoiceKeyOf(card, today);
  const closed = cardInvoiceKeys(data, card, today).filter(
    (key) =>
      key < open &&
      invoiceStatus(data, card, key, today) === 'fechada' &&
      invoiceTotal(data, card, key) > 0,
  );
  return closed[0] ?? open;
};

export type CardSummary = {
  readonly card: Card;
  readonly invoice: InvoiceSummary;
  readonly usedCents: Cents;
  readonly usedPercent: number;
  readonly availableCents: Cents;
  readonly daysToDue: number;
};

export const cardSummary = (
  data: FinanceData,
  card: Card,
  today: IsoDate,
): CardSummary => {
  const invoice = invoiceSummary(data, card, vigenteKey(data, card, today), today);
  return {
    card,
    invoice,
    usedCents: invoice.total,
    usedPercent: usedPercent(invoice.total, card.limitCents),
    availableCents: card.limitCents - invoice.total,
    daysToDue: diffDays(today, invoice.due),
  };
};

/** RN-48: soma das faturas vigentes não pagas dos cartões ativos. */
export const openInvoicesTotal = (summaries: readonly CardSummary[]): Cents =>
  summaries.reduce((sum, item) => sum + item.usedCents, 0);

export type UpcomingCell = {
  readonly cardId: string;
  /** `null` é o `—`: nada a pagar no mês, ou fatura já paga. */
  readonly cents: Cents | null;
};

export type UpcomingRow = {
  readonly key: string;
  readonly status: Exclude<InvoiceStatus, 'paga'>;
  readonly cells: readonly UpcomingCell[];
  readonly total: Cents;
};

/**
 * FIN-502 · As faturas a pagar, da vigente em diante, uma coluna por cartão.
 * A situação da linha é a mais urgente entre os cartões: fechada, aberta, prevista.
 */
export const upcomingInvoices = (
  data: FinanceData,
  today: IsoDate,
): readonly UpcomingRow[] => {
  if (data.cards.length === 0) return [];
  const first = data.cards.map((card) => vigenteKey(data, card, today)).sort()[0] ?? '';
  const last = data.cards
    .flatMap((card) => cardInvoiceKeys(data, card, today))
    .sort()
    .pop();
  if (last === undefined) return [];
  const rows: UpcomingRow[] = [];
  for (let key = first; key <= last; key = shiftInvoice(key, 1)) {
    const cells = data.cards.map((card): UpcomingCell => {
      const unpaid = invoiceStatus(data, card, key, today) !== 'paga';
      const total = unpaid ? invoiceTotal(data, card, key) : 0;
      return { cardId: card.id, cents: total > 0 ? total : null };
    });
    const statuses = data.cards
      .filter((_, index) => cells[index]?.cents !== null)
      .map((card) => invoiceStatus(data, card, key, today));
    const status = statuses.includes('fechada')
      ? 'fechada'
      : statuses.includes('aberta')
        ? 'aberta'
        : 'prevista';
    rows.push({
      key,
      status,
      cells,
      total: cells.reduce((sum, cell) => sum + (cell.cents ?? 0), 0),
    });
  }
  return rows;
};
