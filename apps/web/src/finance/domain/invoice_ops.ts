import { compareDates } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { findCard, invoiceStatus, invoiceTotal } from './cards.js';
import type { FinanceData } from './types.js';

/**
 * FIN-507 · Pagar fatura (RN-50). O pagamento debita a conta do cartão no valor
 * do total e marca a fatura como paga; não cria despesa, porque as compras já
 * foram contadas. Só vale para fatura fechada ou aberta (RN-43, RN-53).
 */

export const payBlockedReason = (
  data: FinanceData,
  cardId: string,
  key: string,
  today: IsoDate,
): string | null => {
  const card = findCard(data, cardId);
  if (card === undefined) return 'Cartão não encontrado.';
  const status = invoiceStatus(data, card, key, today);
  if (status === 'paga') return 'Esta fatura já foi paga.';
  if (status === 'prevista') return 'A fatura prevista ainda não fechou nem abriu.';
  if (invoiceTotal(data, card, key) <= 0) return 'A fatura não tem nada a pagar.';
  return null;
};

export const payInvoiceDateError = (date: IsoDate, today: IsoDate): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Informe a data.';
  if (compareDates(date, today) > 0) return 'A data do pagamento não pode ser futura.';
  return null;
};

export const payInvoice = (
  data: FinanceData,
  cardId: string,
  key: string,
  date: IsoDate,
  today: IsoDate,
): FinanceData => {
  const card = findCard(data, cardId);
  if (card === undefined) return data;
  if (payBlockedReason(data, cardId, key, today) !== null) return data;
  if (payInvoiceDateError(date, today) !== null) return data;
  return {
    ...data,
    payments: [
      ...data.payments,
      {
        id: `p-${cardId}-${key}`,
        cardId,
        invoice: key,
        date,
        accountId: card.payerId,
        cents: invoiceTotal(data, card, key),
      },
    ],
  };
};
