import type { FinEntry, FinSnapshot } from '@patrimonio/domain';

import { accountBalance } from './accounts.js';
import { cardInvoiceKeys, invoiceTotal } from './cards.js';
import { monthKey, monthRange } from './dates.js';
import { dec, money } from './money.js';
import { indicators, ledgerPool } from './ledger.js';
import { findAccount, findCard } from './lookup.js';
import type { Warning } from './benefits.js';

/**
 * "Efeito · antes → depois" dos modais: o que muda nos números se a pessoa
 * salvar. É calculado comparando o snapshot de antes com o que a operação
 * devolve — a mesma função que a gravação aplica (T-03) — e nada é estimado à
 * parte.
 */

export type AccountEffect = {
  readonly account_id: string;
  readonly name: string;
  readonly before: string;
  readonly after: string;
};

export type InvoiceEffect = {
  readonly card_id: string;
  readonly name: string;
  readonly month: string;
  readonly before: string;
  readonly after: string;
};

export type MonthEffect = {
  readonly month: string;
  readonly receitas_before: string;
  readonly receitas_after: string;
  readonly despesas_before: string;
  readonly despesas_after: string;
  readonly a_lancar_before: string;
  readonly a_lancar_after: string;
};

export type InstallmentEffect = {
  readonly entry_id: string;
  readonly no: number;
  readonly total: number;
  readonly date: string;
  readonly amount_before: string | null;
  readonly amount_after: string | null;
  readonly change: 'criada' | 'alterada' | 'removida';
};

export type Effect = {
  readonly accounts: readonly AccountEffect[];
  readonly invoices: readonly InvoiceEffect[];
  readonly months: readonly MonthEffect[];
  readonly installments: readonly InstallmentEffect[];
  readonly warnings: readonly Warning[];
};

const changedEntries = (
  before: FinSnapshot,
  after: FinSnapshot,
): { readonly old: FinEntry | undefined; readonly next: FinEntry | undefined }[] => {
  const ids = new Set([
    ...before.entries.map((e) => e.id),
    ...after.entries.map((e) => e.id),
  ]);
  return [...ids]
    .map((id) => ({
      old: before.entries.find((e) => e.id === id),
      next: after.entries.find((e) => e.id === id),
    }))
    .filter(({ old, next }) => JSON.stringify(old) !== JSON.stringify(next));
};

const sources = (
  entry: FinEntry | undefined,
): readonly { type: string; id: string; month: string | null }[] =>
  (entry?.payments ?? []).map((p) => ({
    type: p.source_type,
    id: p.source_id,
    month: p.invoice_month,
  }));

export const effectBetween = (
  before: FinSnapshot,
  after: FinSnapshot,
  today: string,
  warnings: readonly Warning[] = [],
): Effect => {
  const changed = changedEntries(before, after);

  const accountIds = new Set<string>();
  const invoiceKeys = new Map<string, { cardId: string; month: string }>();
  const months = new Set<string>();

  for (const { old, next } of changed) {
    for (const entry of [old, next]) {
      if (entry === undefined) continue;
      months.add(monthKey(entry.date));
      for (const part of sources(entry)) {
        if (part.type === 'conta') accountIds.add(part.id);
        else if (part.month !== null)
          invoiceKeys.set(`${part.id}|${part.month}`, {
            cardId: part.id,
            month: part.month,
          });
      }
    }
  }

  // Movimentações, itens de fatura e pagamentos que mudaram também mexem em saldos e faturas.
  const touch = <T extends { id: string }>(
    a: readonly T[],
    b: readonly T[],
  ): readonly T[] => {
    const prior = new Map(a.map((r) => [r.id, JSON.stringify(r)] as const));
    const ids = new Set(b.map((r) => r.id));
    return [
      ...b.filter((r) => prior.get(r.id) !== JSON.stringify(r)),
      ...a.filter((r) => !ids.has(r.id)),
    ];
  };
  for (const movement of touch(before.movements, after.movements))
    accountIds.add(movement.account_id);
  for (const item of touch(before.card_items, after.card_items)) {
    invoiceKeys.set(`${item.card_id}|${item.invoice_month}`, {
      cardId: item.card_id,
      month: item.invoice_month,
    });
  }
  for (const payment of touch(before.invoice_payments, after.invoice_payments)) {
    accountIds.add(payment.account_id);
    invoiceKeys.set(`${payment.card_id}|${payment.invoice_month}`, {
      cardId: payment.card_id,
      month: payment.invoice_month,
    });
  }

  const accounts = [...accountIds]
    .map((id): AccountEffect | null => {
      const account = findAccount(after, id) ?? findAccount(before, id);
      if (account === undefined) return null;
      return {
        account_id: id,
        name: account.name,
        before: money(accountBalance(before, id, today)),
        after: money(accountBalance(after, id, today)),
      };
    })
    .filter((row): row is AccountEffect => row !== null && row.before !== row.after);

  const invoices = [...invoiceKeys.values()]
    .map(({ cardId, month }): InvoiceEffect | null => {
      const cardBefore = findCard(before, cardId);
      const cardAfter = findCard(after, cardId);
      const card = cardAfter ?? cardBefore;
      if (card === undefined) return null;
      return {
        card_id: cardId,
        name: card.name,
        month,
        before:
          cardBefore === undefined
            ? '0.00'
            : money(invoiceTotal(before, cardBefore, month)),
        after:
          cardAfter === undefined ? '0.00' : money(invoiceTotal(after, cardAfter, month)),
      };
    })
    .filter((row): row is InvoiceEffect => row !== null && row.before !== row.after)
    .sort((a, b) => a.card_id.localeCompare(b.card_id) || a.month.localeCompare(b.month));

  const monthEffects = [...months].sort().map((month): MonthEffect => {
    const range = monthRange(month);
    const a = indicators(ledgerPool(before), range);
    const b = indicators(ledgerPool(after), range);
    return {
      month,
      receitas_before: a.receitas.amount,
      receitas_after: b.receitas.amount,
      despesas_before: a.despesas.amount,
      despesas_after: b.despesas.amount,
      a_lancar_before: a.a_lancar.amount,
      a_lancar_after: b.a_lancar.amount,
    };
  });

  const installments = changed
    .filter(({ old, next }) => (old ?? next)?.installment != null)
    .map(({ old, next }): InstallmentEffect => {
      const entry = (next ?? old) as FinEntry;
      return {
        entry_id: entry.id,
        no: entry.installment?.no ?? 0,
        total: entry.installment?.total ?? 0,
        date: entry.date,
        amount_before: old === undefined ? null : old.amount,
        amount_after: next === undefined ? null : next.amount,
        change:
          old === undefined ? 'criada' : next === undefined ? 'removida' : 'alterada',
      };
    })
    .sort((a, b) => a.no - b.no);

  return { accounts, invoices, months: monthEffects, installments, warnings };
};

export { cardInvoiceKeys, dec };
