import type { FinSnapshot } from '@patrimonio/domain';
import { isUndatedDate } from '@patrimonio/domain';

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
  /** Como o aporte se chama na tela ("Aporte recorrente · Emergência"). */
  readonly label?: string | undefined;
  readonly id?: string | undefined;
  readonly portfolio_id?: string | undefined;
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

export type ProjectedParts = {
  readonly em_contas: string;
  readonly entradas: string;
  readonly saidas: string;
  readonly aportes: string;
  readonly faturas: string;
  readonly saldo: string;
};

/**
 * O saldo previsto ao fim de `upTo`, com as linhas que o compõem (VGR-04): de
 * todas as contas com "no patrimônio" ou, com `accountId`, só da conta
 * (CTA-01). Mesma fórmula nos dois casos.
 */
export const projectedParts = (
  data: FinSnapshot,
  upTo: string,
  today: string,
  aportes: readonly PlannedAporte[] = [],
  accountId?: string,
): ProjectedParts => {
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
  return {
    em_contas: money(base),
    entradas: money(receitas),
    saidas: money(despesas),
    aportes: money(aportesPrevistos),
    faturas: money(faturas),
    saldo: money(
      base.plus(receitas).minus(despesas).minus(aportesPrevistos).minus(faturas),
    ),
  };
};

export const projectedBalance = (
  data: FinSnapshot,
  upTo: string,
  today: string,
  aportes: readonly PlannedAporte[] = [],
  accountId?: string,
): string => projectedParts(data, upTo, today, aportes, accountId).saldo;

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

export type NextPlanned = {
  readonly date: string;
  readonly label: string;
  /** Com sinal: positivo entra na conta, negativo sai. */
  readonly amount: string;
};

/**
 * CTA-01 · O próximo previsto de uma conta: a linha mais próxima entre os
 * lançamentos previstos que passam por ela, os aportes previstos que saem dela e
 * as faturas dos cartões que ela paga. Vencidos contam até serem lançados (RN-13).
 */
export const nextPlanned = (
  data: FinSnapshot,
  accountId: string,
  today: string,
  aportes: readonly PlannedAporte[] = [],
): NextPlanned | null => {
  const found: NextPlanned[] = [];
  for (const entry of ledgerPool(data)) {
    if (entry.status !== 'prevista' || isUndatedDate(entry.date)) continue;
    const part = fromAccounts(entry, accountId);
    if (part.lte(0)) continue;
    found.push({
      date: entry.date,
      label: entry.description,
      amount: money(entry.kind === 'receita' ? part : part.neg()),
    });
  }
  for (const aporte of aportes) {
    if (aporte.account_id !== accountId) continue;
    found.push({
      date: aporte.date,
      label: aporte.label ?? 'aporte',
      amount: money(dec(aporte.amount).neg()),
    });
  }
  for (const card of activeCards(data)) {
    if (card.pay_account_id !== accountId) continue;
    for (const key of cardInvoiceKeys(data, card, today)) {
      const remaining = invoiceRemaining(data, card, key);
      if (remaining.lte(0)) continue;
      found.push({
        date: invoiceDue(card, key),
        label: `fatura ${card.name}`,
        amount: money(remaining.neg()),
      });
    }
  }
  return found.sort((a, b) => compareDates(a.date, b.date))[0] ?? null;
};

export type PlannedStatementLine = {
  readonly id: string;
  readonly date: string;
  readonly origin: 'receita' | 'despesa' | 'aporte' | 'fatura';
  readonly description: string;
  /** Com sinal: positivo entra na conta, negativo sai. */
  readonly amount: string;
  /** O saldo previsto da conta logo depois desta linha. */
  readonly balance_after: string;
  readonly entry_id: string | null;
  readonly category_id: string | null;
  readonly portfolio_id: string | null;
  readonly card_id: string | null;
};

/**
 * CTA-02 · As linhas previstas de uma conta dentro do período, com o saldo
 * previsto depois de cada uma, partindo do saldo de hoje. Mesma fórmula do saldo
 * previsto de Contas: lançamentos previstos, aportes previstos e faturas (RN-U9).
 */
export const plannedStatement = (
  data: FinSnapshot,
  accountId: string,
  today: string,
  range: DateRange,
  aportes: readonly PlannedAporte[] = [],
): readonly PlannedStatementLine[] => {
  type Raw = Omit<PlannedStatementLine, 'balance_after'> & { readonly rank: number };
  const inside = (date: string): boolean =>
    compareDates(date, range.from) >= 0 && compareDates(date, range.to) <= 0;
  const raw: Raw[] = [];
  for (const entry of ledgerPool(data)) {
    if (entry.status !== 'prevista' || !inside(entry.date)) continue;
    const part = fromAccounts(entry, accountId);
    if (part.lte(0)) continue;
    raw.push({
      id: entry.id,
      date: entry.date,
      origin: entry.kind === 'receita' ? 'receita' : 'despesa',
      description: entry.description,
      amount: money(entry.kind === 'receita' ? part : part.neg()),
      entry_id: entry.id,
      category_id: entry.category_id,
      portfolio_id: null,
      card_id: null,
      rank: entry.kind === 'receita' ? 0 : 1,
    });
  }
  for (const aporte of aportes) {
    if (aporte.account_id !== accountId || !inside(aporte.date)) continue;
    raw.push({
      id: aporte.id ?? `aporte:${aporte.date}`,
      date: aporte.date,
      origin: 'aporte',
      description: aporte.label ?? 'Aporte',
      amount: money(dec(aporte.amount).neg()),
      entry_id: null,
      category_id: null,
      portfolio_id: aporte.portfolio_id ?? null,
      card_id: null,
      rank: 2,
    });
  }
  for (const card of activeCards(data)) {
    if (card.pay_account_id !== accountId) continue;
    for (const key of cardInvoiceKeys(data, card, today)) {
      const due = invoiceDue(card, key);
      const remaining = invoiceRemaining(data, card, key);
      if (remaining.lte(0) || !inside(due)) continue;
      raw.push({
        id: `fatura:${card.id}:${key}`,
        date: due,
        origin: 'fatura',
        description: `Pagamento da fatura ${card.name}`,
        amount: money(remaining.neg()),
        entry_id: null,
        category_id: null,
        portfolio_id: null,
        card_id: card.id,
        rank: 2,
      });
    }
  }
  raw.sort((a, b) => compareDates(a.date, b.date) || a.rank - b.rank);
  let balance = dec(accountBalance(data, accountId, today));
  return raw.map(({ rank: _rank, ...line }) => {
    balance = balance.plus(line.amount);
    return { ...line, balance_after: money(balance) };
  });
};
