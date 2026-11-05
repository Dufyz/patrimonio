import { accountBalance, findAccount } from './accounts.js';
import { findCard, invoiceKeyOf, invoiceTotal, shiftInvoice } from './cards.js';
import {
  addEntry,
  installmentCount,
  launchEntry,
  paymentsOf,
  validateEntry,
} from './entry_ops.js';
import type { EntryDraft } from './entry_ops.js';
import { deleteInstallments } from './installment_ops.js';
import type { InstallmentScope } from './installment_ops.js';
import { payInvoice } from './invoice_ops.js';
import {
  addRecurring,
  syncRecurring,
  updateRecurring,
  validateRecurring,
} from './recurring.js';
import type { RecurringDraft } from './recurring.js';
import { sourceName } from './sources.js';
import { monthResult } from './overview.js';
import type { FinanceData } from './types.js';
import type { IsoDate } from '../lib/dates.js';
import type { Cents } from '../lib/money.js';
import { formatMonth } from '../lib/format.js';
import { currentMonth } from '../lib/period.js';

/**
 * "Efeito · antes → depois" dos modais: o que muda nos números se a pessoa
 * salvar. É calculado aplicando a mesma operação que o botão aplica e
 * comparando; nada é estimado à parte.
 */

export type EffectRow = {
  readonly label: string;
  readonly hint?: string;
  readonly before: Cents;
  readonly after: Cents;
};

const monthLabel = (date: IsoDate): string => formatMonth(date).replace(' de ', '/');

/** Novo lançamento (prancha Modais A e B). `null` enquanto o rascunho não é válido. */
export const entryEffect = (
  data: FinanceData,
  draft: EntryDraft,
  today: IsoDate,
): readonly EffectRow[] | null => {
  if (Object.keys(validateEntry(data, draft, today, true)).length > 0) return null;
  const after = addEntry(data, draft, today);
  if (after === data) return null;
  return effectBetween(data, after, draft, today);
};

/** Lançar um previsto com o valor real (prancha Modais M). */
export const launchEffect = (
  data: FinanceData,
  id: string,
  draft: EntryDraft,
  today: IsoDate,
): readonly EffectRow[] | null => {
  const after = launchEntry(data, id, draft, today);
  if (after === data) return null;
  return effectBetween(data, after, draft, today);
};

const effectBetween = (
  data: FinanceData,
  after: FinanceData,
  draft: EntryDraft,
  today: IsoDate,
): readonly EffectRow[] => {
  const range = currentMonth(draft.date);
  const rows: EffectRow[] = [];
  const flow = draft.kind === 'receita' ? 'receitas' : 'despesas';
  const flowBefore = monthResult(data, range, today)[flow].cents;
  const flowAfter = monthResult(after, range, today)[flow].cents;
  rows.push({
    label: `${draft.kind === 'receita' ? 'Receitas' : 'Despesas'} de ${monthLabel(draft.date)}`,
    before: flowBefore,
    after: flowAfter,
  });
  for (const payment of paymentsOf(draft)) {
    const card = findCard(data, payment.sourceId);
    if (card !== undefined) {
      const key = invoiceKeyOf(card, draft.date);
      rows.push({
        label: `Fatura de ${monthLabel(`${key}-01`)}`,
        hint: card.name,
        before: invoiceTotal(data, card, key),
        after: invoiceTotal(after, card, key),
      });
      const count = installmentCount(data, draft);
      if (count > 1) {
        const future = (d: FinanceData): Cents =>
          Array.from({ length: count - 1 }, (_, i) =>
            invoiceTotal(d, card, shiftInvoice(key, i + 1)),
          ).reduce((a, b) => a + b, 0);
        rows.push({
          label: 'Parcelas futuras do cartão',
          before: future(data),
          after: future(after),
        });
      }
    } else if (findAccount(data, payment.sourceId) !== undefined) {
      rows.push({
        label: findAccount(data, payment.sourceId)?.name ?? payment.sourceId,
        hint: 'saldo',
        before: accountBalance(data, payment.sourceId, today),
        after: accountBalance(after, payment.sourceId, today),
      });
    }
  }
  return rows;
};

/** Pagar fatura (prancha Modais D). */
export const payInvoiceEffect = (
  data: FinanceData,
  cardId: string,
  key: string,
  date: IsoDate,
  today: IsoDate,
): readonly EffectRow[] => {
  const card = findCard(data, cardId);
  if (card === undefined) return [];
  const after = payInvoice(data, cardId, key, date, today);
  return [
    {
      label: findAccount(data, card.payerId)?.name ?? card.payerId,
      hint: 'saldo',
      before: accountBalance(data, card.payerId, today),
      after: accountBalance(after, card.payerId, today),
    },
  ];
};

/** Excluir parcela(s) de uma compra no cartão (prancha Modais E): a fatura aberta e as futuras. */
export const deleteInstallmentEffect = (
  data: FinanceData,
  cardId: string,
  key: string,
  origin: 'entry' | 'item',
  id: string,
  scope: InstallmentScope,
): readonly EffectRow[] => {
  const card = findCard(data, cardId);
  if (card === undefined) return [];
  const after = deleteInstallments(data, origin, id, scope);
  const future = (d: FinanceData): Cents =>
    Array.from({ length: 36 }, (_, i) =>
      invoiceTotal(d, card, shiftInvoice(key, i + 1)),
    ).reduce((a, b) => a + b, 0);
  return [
    {
      label: `Fatura de ${monthLabel(`${key}-01`)}`,
      before: invoiceTotal(data, card, key),
      after: invoiceTotal(after, card, key),
    },
    { label: 'Parcelas futuras', before: future(data), after: future(after) },
  ];
};

/**
 * Novo recorrente (prancha Modais G): o que o previsto do mês muda — o total de
 * despesas (ou receitas) previstas e a saída prevista de cada origem.
 */
export const recurringEffect = (
  data: FinanceData,
  draft: RecurringDraft,
  today: IsoDate,
  /** Ao editar, o id do recorrente: o "depois" substitui o item em vez de somar outro. */
  existingId?: string,
): readonly EffectRow[] | null => {
  if (Object.keys(validateRecurring(data, draft)).length > 0) return null;
  const changed =
    existingId === undefined
      ? addRecurring(data, draft, today)
      : updateRecurring(data, existingId, draft, today);
  const after = syncRecurring(changed, today);
  const range = currentMonth(today);
  const planned = (d: FinanceData) =>
    d.entries.filter(
      (e) =>
        e.status === 'prevista' &&
        e.kind === draft.kind &&
        e.date >= range.from &&
        e.date <= range.to,
    );
  const total = (d: FinanceData): Cents =>
    planned(d).reduce((sum, e) => sum + e.cents, 0);
  const bySource = (d: FinanceData, id: string): Cents =>
    planned(d)
      .flatMap((e) => e.payments)
      .filter((p) => p.sourceId === id)
      .reduce((sum, p) => sum + p.cents, 0);
  const ids = [
    ...new Set(planned(after).flatMap((e) => e.payments.map((p) => p.sourceId))),
  ];
  const noun = draft.kind === 'receita' ? 'Receitas' : 'Despesas';
  return [
    { label: `${noun} previstas`, before: total(data), after: total(after) },
    ...ids.map((id) => ({
      label: `${draft.kind === 'receita' ? 'Entrada' : 'Saída'} prevista de ${sourceName(data, id)}`,
      before: bySource(data, id),
      after: bySource(after, id),
    })),
  ];
};

export const effectMonthLabel = (today: IsoDate): string =>
  `${monthLabel(today).toLowerCase()}`;
