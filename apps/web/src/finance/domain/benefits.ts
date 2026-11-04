import { addMonths, compareDates, monthKey, startOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { formatBRL } from '../lib/format.js';
import { accountBalance, findAccount } from './accounts.js';
import { paymentsOf } from './entry_ops.js';
import type { EntryDraft } from './entry_ops.js';
import { dateInMonth } from './recurring.js';
import type { FinanceData, Movement } from './types.js';

/**
 * FIN-408 · Benefícios: o crédito mensal e o aviso de saldo.
 *
 * O crédito (RN-36) é uma movimentação do benefício, não uma receita: não
 * aparece em Lançamentos nem em Receitas. É gerado no dia configurado, uma vez
 * por mês (`credit:<conta>:<AAAA-MM>`), e repetir a rotina não duplica nada.
 */

export const syncBenefitCredits = (data: FinanceData, today: IsoDate): FinanceData => {
  const existing = new Set(data.movements.map((movement) => movement.id));
  const added: Movement[] = [];

  for (const account of data.accounts) {
    if (account.type !== 'beneficio' || account.archived === true) continue;
    const { creditCents, creditDay, creditsFrom } = account;
    if (creditCents === undefined || creditDay === undefined || creditsFrom === undefined)
      continue;

    for (
      let month = startOfMonth(creditsFrom);
      compareDates(month, today) <= 0;
      month = addMonths(month, 1)
    ) {
      const date = dateInMonth(month, creditDay);
      if (compareDates(date, today) > 0) break;
      const id = `credit:${account.id}:${monthKey(month)}`;
      if (existing.has(id)) continue;
      added.push({
        id,
        date,
        accountId: account.id,
        kind: 'credito',
        cents: creditCents,
        description: 'Crédito mensal',
      });
    }
  }

  return added.length === 0
    ? data
    : { ...data, movements: [...data.movements, ...added] };
};

/**
 * RN-24 e FIN-408: parte maior que o saldo do benefício. É um aviso, não um
 * bloqueio. Ao editar um lançamento já lançado, a parte antiga volta ao saldo
 * antes da comparação, porque ela já está descontada dele.
 */
export const benefitWarnings = (
  data: FinanceData,
  draft: EntryDraft,
  today: IsoDate,
  ignoreEntryId?: string,
): readonly string[] => {
  if (draft.kind !== 'despesa') return [];
  const previous = data.entries.find((entry) => entry.id === ignoreEntryId);
  const warnings: string[] = [];

  for (const payment of paymentsOf(draft)) {
    const account = findAccount(data, payment.sourceId);
    if (account === undefined || account.type !== 'beneficio') continue;
    const refund =
      previous !== undefined &&
      previous.status === 'lancada' &&
      compareDates(previous.date, today) <= 0
        ? (previous.payments.find((p) => p.sourceId === account.id)?.cents ?? 0)
        : 0;
    const balance = accountBalance(data, account.id, today) + refund;
    if (payment.cents > balance) {
      warnings.push(
        `${account.name} tem ${formatBRL(balance)} de saldo e esta parte é de ${formatBRL(payment.cents)}.`,
      );
    }
  }
  return warnings;
};
