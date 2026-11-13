import type { FinCard, FinSnapshot } from '@patrimonio/domain';

import {
  cardInvoiceKeys,
  invoiceKeyOf,
  invoiceLines,
  invoicePeriod,
  invoiceRemaining,
  invoiceSummary,
  vigenteKey,
} from './cards.js';
import type { InvoiceSummary } from './cards.js';
import { dec, money, total, ZERO } from './money.js';

/**
 * CRT-03 · Um cartão: as faturas por mês, as compras parceladas em andamento e
 * os pagamentos previstos. Tudo derivado; nada é gravado.
 */
export type CardInvoiceRow = InvoiceSummary & {
  /** Primeiro e último dia de compras. */
  readonly from: string;
  readonly to: string;
  /** Pagamentos feitos, para "paga em dd/mm · conta". */
  readonly payments: readonly {
    readonly date: string;
    readonly account_id: string;
    readonly amount: string;
  }[];
};

export type CardInstallmentPlan = {
  readonly description: string;
  readonly origin: string;
  readonly category_id: string | null;
  /** A parcela atual: a mais recente que já caiu numa fatura aberta ou fechada. */
  readonly current: number;
  readonly total: number;
  readonly amount: string;
  /** Soma das parcelas que ainda virão. */
  readonly remaining: string;
};

export type PlannedPayment = {
  readonly month: string;
  readonly due: string;
  readonly amount: string;
  readonly status: InvoiceSummary['status'];
  readonly account_id: string;
};

export type CardDetail = {
  /** Da prevista mais distante à mais antiga. */
  readonly invoices: readonly CardInvoiceRow[];
  readonly installments: readonly CardInstallmentPlan[];
  readonly planned_payments: readonly PlannedPayment[];
};

export const cardDetail = (
  data: FinSnapshot,
  card: FinCard,
  today: string,
): CardDetail => {
  const keys = cardInvoiceKeys(data, card, today);
  const open = invoiceKeyOf(card, today);

  const invoices = [...keys].reverse().map((key): CardInvoiceRow => {
    const { from, to } = invoicePeriod(card, key);
    return {
      ...invoiceSummary(data, card, key, today),
      from,
      to,
      payments: data.invoice_payments
        .filter((p) => p.card_id === card.id && p.invoice_month === key)
        .map((p) => ({ date: p.date, account_id: p.account_id, amount: p.amount })),
    };
  });

  const plans = new Map<
    string,
    {
      description: string;
      origin: string;
      category_id: string | null;
      total: number;
      amount: string;
      parts: { no: number; key: string; amount: string }[];
    }
  >();
  for (const key of keys) {
    for (const line of invoiceLines(data, card, key)) {
      if (line.installment === null || line.block === 'creditos') continue;
      const id = `${line.description}|${line.date}|${line.installment.total}`;
      const plan = plans.get(id) ?? {
        description: line.description,
        origin: line.date,
        category_id: line.category_id,
        total: line.installment.total,
        amount: line.amount,
        parts: [],
      };
      plan.parts.push({ no: line.installment.no, key, amount: line.amount });
      plans.set(id, plan);
    }
  }
  const installments = [...plans.values()]
    .map((plan): CardInstallmentPlan => {
      const posted = plan.parts.filter((p) => p.key <= open);
      const current = posted.reduce((max, p) => Math.max(max, p.no), 0);
      const later = plan.parts.filter((p) => p.no > current);
      return {
        description: plan.description,
        origin: plan.origin,
        category_id: plan.category_id,
        current,
        total: plan.total,
        amount: plan.amount,
        remaining: money(total(later.map((p) => dec(p.amount)))),
      };
    })
    .filter((plan) => plan.current < plan.total)
    .sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));

  const planned_payments = keys
    .filter(
      (key) =>
        invoiceRemaining(data, card, key).gt(ZERO) &&
        key >= vigenteKey(data, card, today),
    )
    .map((key): PlannedPayment => {
      const summary = invoiceSummary(data, card, key, today);
      return {
        month: key,
        due: summary.due,
        amount: summary.remaining,
        status: summary.status,
        account_id: card.pay_account_id,
      };
    });

  return { invoices, installments, planned_payments };
};
