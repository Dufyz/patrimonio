import { accountBalance, findAccount } from './accounts.js';
import { findCard, invoiceKeyOf, invoiceTotal, shiftInvoice } from './cards.js';
import { addEntry, installmentCount, paymentsOf, validateEntry } from './entry_ops.js';
import type { EntryDraft } from './entry_ops.js';
import { payInvoice } from './invoice_ops.js';
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
  if (Object.keys(validateEntry(data, draft, today)).length > 0) return null;
  const after = addEntry(data, draft, today);
  if (after === data) return null;
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
