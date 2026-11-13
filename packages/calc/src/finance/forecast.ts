import type { FinSnapshot } from '@patrimonio/domain';

import { accountBalance, dailyTotalInAccounts, totalInAccounts } from './accounts.js';
import type { DailyBalance } from './accounts.js';
import { activeCards, cardInvoiceKeys, invoiceDue, invoiceRemaining } from './cards.js';
import { addDays, compareDates } from './dates.js';
import type { DateRange } from './dates.js';
import { ledgerPool } from './ledger.js';
import { dec, money, total } from './money.js';

/**
 * LIV-10 · Saldo previsto (RN-U9). Uma função para Visão geral (Tudo e Fluxo),
 * Contas e qualquer outra leitura (RN-U16):
 *
 *   Em contas hoje + receitas previstas − despesas previstas
 *     − aportes previstos − faturas que vencem até a data.
 *
 * Previstos vencidos continuam somando até serem lançados ou excluídos (RN-13).
 * A compra prevista no cartão sai da conta no vencimento da fatura, não na data
 * da compra: ela já está dentro do total da fatura, e por isso só os previstos
 * pagos direto da conta entram como despesa prevista.
 */

export type PlannedAporte = {
  readonly date: string;
  readonly amount: string;
  /** Nulo é "Fora do app": não sai de conta nenhuma, então não reduz o saldo. */
  readonly account_id: string | null;
};

const fromAccounts = (
  entry: {
    readonly payments: readonly {
      readonly source_type: string;
      readonly source_id: string;
      readonly amount: string;
    }[];
    readonly amount: string;
  },
  accountId?: string,
) =>
  entry.payments.length === 0
    ? accountId === undefined
      ? dec(entry.amount)
      : dec('0')
    : total(
        entry.payments
          .filter(
            (payment) =>
              payment.source_type === 'conta' &&
              (accountId === undefined || payment.source_id === accountId),
          )
          .map((payment) => dec(payment.amount)),
      );

/**
 * O saldo previsto ao fim de `upTo`: de todas as contas com "no patrimônio" ou,
 * com `accountId`, só da conta (CTA-01). Mesma fórmula nos dois casos.
 */
export const projectedBalance = (
  data: FinSnapshot,
  upTo: string,
  today: string,
  aportes: readonly PlannedAporte[] = [],
  accountId?: string,
): string => {
  const planned = ledgerPool(data).filter(
    (entry) => entry.status === 'prevista' && compareDates(entry.date, upTo) <= 0,
  );
  const receitas = total(
    planned.filter((e) => e.kind === 'receita').map((e) => fromAccounts(e, accountId)),
  );
  const despesas = total(
    planned.filter((e) => e.kind === 'despesa').map((e) => fromAccounts(e, accountId)),
  );
  const aportesPrevistos = total(
    aportes
      .filter(
        (a) =>
          a.account_id !== null &&
          (accountId === undefined || a.account_id === accountId) &&
          compareDates(a.date, upTo) <= 0,
      )
      .map((a) => dec(a.amount)),
  );
  const faturas = total(
    activeCards(data)
      .filter((card) => accountId === undefined || card.pay_account_id === accountId)
      .flatMap((card) =>
        cardInvoiceKeys(data, card, today)
          .filter((key) => compareDates(invoiceDue(card, key), upTo) <= 0)
          .map((key) => invoiceRemaining(data, card, key)),
      ),
  );

  const base =
    accountId === undefined
      ? totalInAccounts(data, today)
      : dec(accountBalance(data, accountId, today));
  return money(
    base.plus(receitas).minus(despesas).minus(aportesPrevistos).minus(faturas),
  );
};

export type ForecastPoint = {
  readonly date: string;
  readonly balance: string;
  /** Falso no trecho realizado, verdadeiro no previsto. */
  readonly forecast: boolean;
};

export type Forecast = {
  readonly points: readonly ForecastPoint[];
  /** O menor saldo da série, com a data em que acontece. */
  readonly lowest: { readonly date: string; readonly balance: string } | null;
  readonly at_end: string;
};

/** A série diária: realizado até hoje, previsto depois, e o menor saldo com a data. */
export const forecastSeries = (
  data: FinSnapshot,
  range: DateRange,
  today: string,
  aportes: readonly PlannedAporte[] = [],
): Forecast => {
  const realized: readonly DailyBalance[] =
    compareDates(range.from, today) <= 0 ? dailyTotalInAccounts(data, range, today) : [];
  const points: ForecastPoint[] = realized.map((p) => ({ ...p, forecast: false }));

  let date = realized.length === 0 ? range.from : addDays(today, 1);
  if (compareDates(date, range.from) < 0) date = range.from;
  for (; compareDates(date, range.to) <= 0; date = addDays(date, 1)) {
    points.push({
      date,
      balance: projectedBalance(data, date, today, aportes),
      forecast: true,
    });
  }

  let lowest: Forecast['lowest'] = null;
  for (const point of points) {
    if (lowest === null || dec(point.balance).lt(lowest.balance)) {
      lowest = { date: point.date, balance: point.balance };
    }
  }

  return {
    points,
    lowest,
    at_end: points.at(-1)?.balance ?? money(totalInAccounts(data, today)),
  };
};
