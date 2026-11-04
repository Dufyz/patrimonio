import type { FinCardItem, FinSnapshot } from '@patrimonio/domain';
import { FIN_CHARGE_SUBTYPES, FIN_CREDIT_SUBTYPES } from '@patrimonio/domain';
import type { FinCardItemSubtype } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import {
  invoiceDue,
  invoiceKeyOf,
  invoicePeriod,
  invoiceRemaining,
  invoiceStatus,
  invoiceTotals,
  invoiceLines,
} from './cards.js';
import { compareDates, isIsoDate, isMonthKey, shiftMonthKey } from './dates.js';
import { rule } from './errors.js';
import type { FinRuleError } from './errors.js';
import { findAccount, findCard, findCategory } from './lookup.js';
import { dec, min, money } from './money.js';

/**
 * Pagar fatura (RN-50) e os itens que só a fatura tem (RN-46).
 *
 * O pagamento debita a conta escolhida e abate o em aberto; pode ser parcial, mas
 * nunca maior que o em aberto. Não cria despesa — as compras já foram contadas
 * quando lançadas. Crédito reduz o total, encargo aumenta e conta como despesa na
 * categoria; a fatura nunca fica negativa, e o excedente de um crédito vira
 * crédito na fatura seguinte.
 */

export type PayInvoiceInput = {
  /** Padrão: a conta pagadora do cartão. */
  readonly account_id?: string | undefined;
  readonly date: string;
  readonly amount: string;
};

export const payInvoiceErrors = (
  data: FinSnapshot,
  cardId: string,
  month: string,
  input: PayInvoiceInput,
  today: string,
): readonly FinRuleError[] => {
  const card = findCard(data, cardId);
  if (card === undefined) {
    return [rule('CARD_NOT_FOUND', 'Cartão não encontrado.', { status: 404 })];
  }
  if (!isMonthKey(month)) {
    return [
      rule('INVOICE_MONTH_INVALID', 'Informe o mês da fatura (AAAA-MM).', {
        field: 'month',
      }),
    ];
  }

  const errors: FinRuleError[] = [];
  const status = invoiceStatus(data, card, month, today);
  const remaining = invoiceRemaining(data, card, month);

  if (status === 'paga') {
    errors.push(
      rule('INVOICE_ALREADY_PAID', 'Esta fatura já foi paga.', { status: 409 }),
    );
  } else if (status === 'prevista') {
    errors.push(
      rule('INVOICE_NOT_PAYABLE', 'A fatura prevista ainda não fechou nem abriu.'),
    );
  } else if (remaining.lte(0)) {
    errors.push(rule('INVOICE_NOTHING_TO_PAY', 'A fatura não tem nada a pagar.'));
  }

  const account = findAccount(data, input.account_id ?? card.pay_account_id);
  if (account === undefined || account.archived || account.type === 'beneficio') {
    errors.push(
      rule('INVOICE_ACCOUNT_INVALID', 'Escolha uma conta ativa para pagar a fatura.', {
        field: 'account_id',
      }),
    );
  }
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || dec(input.amount).lte(0)) {
    errors.push(
      rule('INVOICE_AMOUNT_INVALID', 'Informe um valor maior que zero.', {
        field: 'amount',
      }),
    );
  } else if (dec(input.amount).gt(remaining) && remaining.gt(0)) {
    errors.push(
      rule('INVOICE_OVERPAYMENT', 'O pagamento não pode ser maior que o em aberto.', {
        field: 'amount',
        details: { remaining: money(remaining) },
      }),
    );
  }
  if (!isIsoDate(input.date)) {
    errors.push(rule('INVOICE_DATE_INVALID', 'Informe a data.', { field: 'date' }));
  } else if (compareDates(input.date, today) > 0) {
    errors.push(
      rule('INVOICE_DATE_INVALID', 'A data do pagamento não pode ser futura.', {
        field: 'date',
      }),
    );
  }
  return errors;
};

export const payInvoice = (
  data: FinSnapshot,
  cardId: string,
  month: string,
  input: PayInvoiceInput,
  today: string,
  newId: () => string,
): Either<readonly FinRuleError[], { data: FinSnapshot; payment_id: string }> => {
  const errors = payInvoiceErrors(data, cardId, month, input, today);
  if (errors.length > 0) return failure(errors);

  const card = findCard(data, cardId);
  const paymentId = newId();
  return success({
    data: {
      ...data,
      invoice_payments: [
        ...data.invoice_payments,
        {
          id: paymentId,
          card_id: cardId,
          invoice_month: month,
          account_id: input.account_id ?? (card?.pay_account_id as string),
          date: input.date,
          amount: money(dec(input.amount)),
          posted: true,
        },
      ],
    },
    payment_id: paymentId,
  });
};

/** Excluir um pagamento devolve o saldo à conta e reabre a fatura. */
export const deleteInvoicePayment = (
  data: FinSnapshot,
  paymentId: string,
): Either<readonly FinRuleError[], FinSnapshot> =>
  data.invoice_payments.some((payment) => payment.id === paymentId)
    ? success({
        ...data,
        invoice_payments: data.invoice_payments.filter(
          (payment) => payment.id !== paymentId,
        ),
      })
    : failure([
        rule('INVOICE_PAYMENT_NOT_FOUND', 'Pagamento não encontrado.', { status: 404 }),
      ]);

export type CardItemInput = {
  readonly kind: 'credito' | 'encargo';
  readonly subtype: FinCardItemSubtype;
  readonly invoice_month: string;
  readonly description: string;
  readonly amount: string;
  readonly date?: string | undefined;
  /** Encargo: a categoria de despesa em que ele conta. */
  readonly category_id?: string | undefined;
};

const validateItem = (
  data: FinSnapshot,
  cardId: string,
  input: CardItemInput,
): readonly FinRuleError[] => {
  const errors: FinRuleError[] = [];
  if (findCard(data, cardId) === undefined) {
    return [rule('CARD_NOT_FOUND', 'Cartão não encontrado.', { status: 404 })];
  }
  if (!isMonthKey(input.invoice_month)) {
    errors.push(
      rule('INVOICE_MONTH_INVALID', 'Informe o mês da fatura (AAAA-MM).', {
        field: 'invoice_month',
      }),
    );
  }
  if (!/^\d+(\.\d{1,2})?$/.test(input.amount) || dec(input.amount).lte(0)) {
    errors.push(
      rule('CARD_ITEM_AMOUNT_INVALID', 'Informe um valor maior que zero.', {
        field: 'amount',
      }),
    );
  }
  if (input.description.trim() === '') {
    errors.push(
      rule('CARD_ITEM_DESCRIPTION_REQUIRED', 'Dê uma descrição.', {
        field: 'description',
      }),
    );
  }
  const allowed: readonly string[] =
    input.kind === 'credito' ? FIN_CREDIT_SUBTYPES : FIN_CHARGE_SUBTYPES;
  if (!allowed.includes(input.subtype)) {
    errors.push(
      rule('CARD_ITEM_SUBTYPE_INVALID', 'Tipo incompatível com o item.', {
        field: 'subtype',
      }),
    );
  }
  if (input.kind === 'encargo') {
    const category =
      input.category_id === undefined ? undefined : findCategory(data, input.category_id);
    if (category === undefined || category.kind !== 'despesa') {
      errors.push(
        rule(
          'CARD_ITEM_CATEGORY_INVALID',
          'O encargo conta como despesa: escolha uma categoria de despesa.',
          {
            field: 'category_id',
          },
        ),
      );
    }
  }
  return errors;
};

/**
 * Crédito/estorno ou encargo na fatura. O crédito maior que o total da fatura é
 * limitado ao total, e o excedente vira crédito na fatura seguinte.
 */
export const addCardItem = (
  data: FinSnapshot,
  cardId: string,
  input: CardItemInput,
  today: string,
  newId: () => string,
): Either<
  readonly FinRuleError[],
  { data: FinSnapshot; created: readonly FinCardItem[] }
> => {
  const errors = validateItem(data, cardId, input);
  if (errors.length > 0) return failure(errors);

  const card = findCard(data, cardId);
  if (card === undefined)
    return failure([rule('CARD_NOT_FOUND', 'Cartão não encontrado.', { status: 404 })]);

  const date =
    input.date ??
    (compareDates(today, invoiceDue(card, input.invoice_month)) <= 0
      ? today
      : invoiceDue(card, input.invoice_month));
  const base = {
    card_id: cardId,
    kind: input.kind,
    subtype: input.subtype,
    purchase_date: date,
    description: input.description.trim(),
    installment: null,
    version: 1,
  } as const;

  const amount = dec(input.amount);
  const created: FinCardItem[] = [];

  if (input.kind === 'encargo') {
    created.push({
      ...base,
      id: newId(),
      invoice_month: input.invoice_month,
      category_id: input.category_id ?? null,
      amount: money(amount),
    });
  } else {
    const totals = invoiceTotals(invoiceLines(data, card, input.invoice_month));
    const current = dec(totals.compras)
      .plus(totals.parcelas)
      .plus(totals.encargos)
      .minus(totals.creditos);
    const applied = min(amount, current.gt(0) ? current : dec('0'));
    const excess = amount.minus(applied);

    if (applied.gt(0)) {
      created.push({
        ...base,
        id: newId(),
        invoice_month: input.invoice_month,
        category_id: null,
        amount: money(applied),
      });
    }
    if (excess.gt(0)) {
      created.push({
        ...base,
        id: newId(),
        invoice_month: shiftMonthKey(input.invoice_month, 1),
        description: `${base.description} (excedente)`,
        category_id: null,
        amount: money(excess),
      });
    }
  }

  return success({
    data: { ...data, card_items: [...data.card_items, ...created] },
    created,
  });
};

export const deleteCardItem = (
  data: FinSnapshot,
  itemId: string,
): Either<readonly FinRuleError[], FinSnapshot> =>
  data.card_items.some((item) => item.id === itemId)
    ? success({
        ...data,
        card_items: data.card_items.filter((item) => item.id !== itemId),
      })
    : failure([
        rule('CARD_ITEM_NOT_FOUND', 'Item da fatura não encontrado.', { status: 404 }),
      ]);

/** O mês de fatura de uma compra feita em `date` no cartão. */
export const invoiceMonthOf = (
  data: FinSnapshot,
  cardId: string,
  date: string,
): string | null => {
  const card = findCard(data, cardId);
  return card === undefined ? null : invoiceKeyOf(card, date);
};

export { invoicePeriod };
