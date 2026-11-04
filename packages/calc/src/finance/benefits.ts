import type { FinMovement, FinPayment, FinSnapshot } from '@patrimonio/domain';

import { accountBalance } from './accounts.js';
import { addMonths, compareDates, dateInMonth, monthKey, startOfMonth } from './dates.js';
import { findAccount, isBenefit } from './lookup.js';
import { dec, money } from './money.js';

/**
 * Benefícios: o crédito mensal e o aviso de saldo (RN-24, RN-36).
 *
 * O crédito é uma movimentação do benefício, não uma receita: não aparece em
 * Lançamentos nem em Receitas. É gerado no dia configurado, uma vez por mês — o
 * índice único `(conta, mês)` do banco garante que repetir a rotina não duplica —
 * e mudar o valor do crédito vale daqui para frente: o que já foi gerado fica.
 */

export const syncBenefitCredits = (
  data: FinSnapshot,
  today: string,
  newId: () => string,
): FinSnapshot => {
  const existing = new Set(
    data.movements
      .filter((movement) => movement.kind === 'credito')
      .map((movement) => `${movement.account_id}:${monthKey(movement.date)}`),
  );
  const added: FinMovement[] = [];

  for (const account of data.accounts) {
    if (!isBenefit(account) || account.archived) continue;
    const { credit_amount, credit_day, credits_from } = account;
    if (credit_amount === null || credit_day === null || credits_from === null) continue;

    for (
      let month = startOfMonth(credits_from);
      compareDates(month, today) <= 0;
      month = addMonths(month, 1)
    ) {
      const date = dateInMonth(month, credit_day);
      if (compareDates(date, today) > 0) break;
      if (existing.has(`${account.id}:${monthKey(date)}`)) continue;
      added.push({
        id: newId(),
        date,
        account_id: account.id,
        kind: 'credito',
        amount: credit_amount,
        description: 'Crédito mensal',
        note: null,
        transfer_id: null,
      });
    }
  }

  return added.length === 0
    ? data
    : { ...data, movements: [...data.movements, ...added] };
};

export type Warning = {
  readonly account_id: string;
  readonly code: 'BENEFIT_BALANCE_EXCEEDED';
  readonly message: string;
};

/**
 * RN-24: parte maior que o saldo do benefício. É um aviso, não um bloqueio. Ao
 * editar um lançamento já lançado, a parte antiga volta ao saldo antes da
 * comparação, porque ela já está descontada dele.
 */
export const benefitWarnings = (
  data: FinSnapshot,
  draft: {
    readonly kind: 'receita' | 'despesa';
    readonly payments: readonly FinPayment[];
  },
  today: string,
  ignoreEntryId?: string,
): readonly Warning[] => {
  if (draft.kind !== 'despesa') return [];
  const previous = data.entries.find((entry) => entry.id === ignoreEntryId);
  const warnings: Warning[] = [];

  for (const payment of draft.payments) {
    if (payment.source_type !== 'conta') continue;
    const account = findAccount(data, payment.source_id);
    if (account === undefined || !isBenefit(account)) continue;

    const refund =
      previous !== undefined &&
      previous.status === 'lancada' &&
      compareDates(previous.date, today) <= 0
        ? dec(previous.payments.find((p) => p.source_id === account.id)?.amount ?? '0')
        : dec('0');
    const balance = accountBalance(data, account.id, today).plus(refund);

    if (dec(payment.amount).gt(balance)) {
      warnings.push({
        account_id: account.id,
        code: 'BENEFIT_BALANCE_EXCEEDED',
        message: `${account.name} tem R$ ${money(balance)} de saldo e esta parte é de R$ ${payment.amount}.`,
      });
    }
  }
  return warnings;
};
