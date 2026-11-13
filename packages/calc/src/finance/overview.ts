import type { FinEntry, FinSnapshot } from '@patrimonio/domain';

import { accountsOverview, dailyTotalInAccounts, totalInAccounts } from './accounts.js';
import type { DailyBalance } from './accounts.js';
import { activeCards, cardSummary } from './cards.js';
import type { InvoiceStatus } from './cards.js';
import {
  addMonths,
  compareDates,
  endOfMonth,
  monthKey,
  monthRange,
  startOfMonth,
} from './dates.js';
import type { DateRange } from './dates.js';
import { money } from './money.js';
import { byLedgerOrder, indicators, isOverdue, isPosted, ledgerPool } from './ledger.js';
import { invoiceDebt } from './wealth.js';
import type { Indicators } from './ledger.js';

/**
 * Visão geral: só resume números que as outras telas produzem. Nada aqui é
 * calculado de outro jeito (T-01, RN-70) — receitas e despesas vêm do mesmo
 * `indicators` da listagem, o em contas vem do mesmo saldo da tela de Contas, e
 * as faturas abertas vêm do mesmo resumo da tela de Cartões.
 */

export type MonthPoint = {
  readonly month: string;
  readonly receitas: string;
  readonly despesas: string;
  readonly saldo: string;
  /** O mês ainda em andamento (RN-63). */
  readonly in_progress: boolean;
};

/** Os 12 meses de calendário que terminam no mês pedido. */
export const monthSeries = (
  data: FinSnapshot,
  month: string,
  today: string,
): readonly MonthPoint[] => {
  const pool = ledgerPool(data);
  return Array.from({ length: 12 }, (_, index) => {
    const start = startOfMonth(addMonths(`${month}-01`, index - 11));
    const range = { from: start, to: endOfMonth(start) };
    const flows = indicators(pool, range);
    return {
      month: monthKey(start),
      receitas: flows.receitas.amount,
      despesas: flows.despesas.amount,
      saldo: flows.saldo,
      in_progress:
        compareDates(today, range.from) >= 0 && compareDates(today, range.to) <= 0,
    };
  });
};

export type UpcomingDue = {
  readonly card_id: string;
  readonly card_name: string;
  readonly account_id: string;
  readonly month: string;
  readonly due: string;
  readonly amount: string;
  readonly status: InvoiceStatus;
  readonly overdue: boolean;
};

export type PendingEntry = {
  readonly entry_id: string;
  readonly description: string;
  readonly date: string;
  readonly amount: string;
  readonly kind: FinEntry['kind'];
};

export type Overview = {
  readonly month: string;
  readonly receitas: { readonly amount: string; readonly count: number };
  readonly despesas: { readonly amount: string; readonly count: number };
  readonly saldo: string;
  readonly a_lancar: { readonly amount: string; readonly count: number };
  readonly em_contas: { readonly amount: string; readonly count: number };
  readonly faturas_abertas: string;
  /** O total em contas ao fim de cada dia do mês, até hoje. */
  readonly daily: readonly DailyBalance[];
  readonly months: readonly MonthPoint[];
  readonly upcoming_dues: readonly UpcomingDue[];
  readonly pending: {
    readonly overdue_entries: readonly PendingEntry[];
    readonly overdue_invoices: readonly UpcomingDue[];
  };
  readonly recent: {
    readonly posted: readonly FinEntry[];
    readonly planned: readonly FinEntry[];
  };
};

const dueOf = (data: FinSnapshot, today: string): readonly UpcomingDue[] =>
  activeCards(data)
    .map((card) => ({ card, summary: cardSummary(data, card, today) }))
    .filter(({ summary }) => summary.used !== '0.00')
    .map(({ card, summary }) => ({
      card_id: card.id,
      card_name: card.name,
      account_id: card.pay_account_id,
      month: summary.invoice.month,
      due: summary.invoice.due,
      amount: summary.used,
      status: summary.invoice.status,
      overdue: summary.invoice.overdue,
    }))
    .sort((a, b) => compareDates(a.due, b.due));

export const overview = (data: FinSnapshot, month: string, today: string): Overview => {
  const range: DateRange = monthRange(month);
  const pool = ledgerPool(data);
  const flows: Indicators = indicators(pool, range);
  const accounts = accountsOverview(data, range, today, false);
  const dues = dueOf(data, today);

  const inRange = pool.filter(
    (entry) =>
      compareDates(entry.date, range.from) >= 0 &&
      compareDates(entry.date, range.to) <= 0,
  );

  return {
    month,
    receitas: flows.receitas,
    despesas: flows.despesas,
    saldo: flows.saldo,
    a_lancar: flows.a_lancar,
    em_contas: {
      amount: money(totalInAccounts(data, today)),
      count: accounts.accounts.filter((a) => !a.account.archived).length,
    },
    // QC-04 · "Faturas abertas" é a mesma conta da tela de Cartões: o que ainda
    // não fechou, menos o pago. A fechada a pagar é outra linha (total devido).
    faturas_abertas: invoiceDebt(data, today).abertas,
    daily: dailyTotalInAccounts(data, range, today),
    months: monthSeries(data, month, today),
    upcoming_dues: dues,
    pending: {
      overdue_entries: pool
        .filter((entry) => isOverdue(data, entry, today))
        .sort((a, b) => compareDates(a.date, b.date))
        .map((entry) => ({
          entry_id: entry.id,
          description: entry.description,
          date: entry.date,
          amount: entry.amount,
          kind: entry.kind,
        })),
      overdue_invoices: dues.filter((due) => due.overdue),
    },
    recent: {
      posted: inRange.filter(isPosted).sort(byLedgerOrder).slice(0, 5),
      planned: inRange
        .filter((entry) => !isPosted(entry))
        .sort((a, b) => -byLedgerOrder(a, b))
        .slice(0, 3),
    },
  };
};
