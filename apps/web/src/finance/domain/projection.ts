import {
  addDays,
  addMonths,
  compareDates,
  endOfMonth,
  monthKey,
  startOfMonth,
} from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { sum } from '../lib/money.js';
import type { Cents } from '../lib/money.js';
import { accountLines } from './accounts.js';
import { invoiceDue, invoiceTotal, paymentOf, shiftInvoice } from './cards.js';
import { dateInMonth, paymentsFor } from './recurring.js';
import type { Entry, FinanceData } from './types.js';

/**
 * Projeção de saldo: como o saldo em contas evolui de hoje até uma data.
 *
 * Parte do saldo de hoje e soma só o que ainda não aconteceu: os previstos que
 * já existem, os recorrentes ativos nos meses seguintes (ocorrências virtuais,
 * nunca gravadas), as parcelas e as faturas, que saem da conta no vencimento
 * (RN-50) e não na compra. Nada aqui entra em saldos, totais ou extratos reais
 * (RN-02): é leitura pura sobre `FinanceData`.
 */

/** Um previsto vencido ainda não aconteceu: conta a partir de hoje (RN-13). */
export const effectiveDate = (entry: Entry, today: IsoDate): IsoDate =>
  compareDates(entry.date, today) < 0 ? today : entry.date;

/**
 * Tudo o que ainda vai acontecer até o horizonte, como lançamentos previstos: os
 * previstos gravados e uma ocorrência por recorrente ativo em cada mês em que ele
 * ainda não tem lançamento nem foi pulado (RN-06, RN-10).
 */
export const plannedEntries = (
  data: FinanceData,
  today: IsoDate,
  horizon: IsoDate,
): readonly Entry[] => {
  const stored = data.entries.filter(
    (entry) =>
      entry.status === 'prevista' &&
      entry.historical !== true &&
      compareDates(effectiveDate(entry, today), horizon) <= 0,
  );

  const skipped = new Set(data.skips ?? []);
  const have = new Set(
    data.entries
      .filter((entry) => entry.recurringId !== undefined)
      .map((entry) => `${entry.recurringId}:${monthKey(entry.date)}`),
  );
  const virtual: Entry[] = [];
  for (const recurring of data.recurrings) {
    if (!recurring.active) continue;
    for (
      let month = startOfMonth(today);
      compareDates(month, horizon) <= 0;
      month = addMonths(month, 1)
    ) {
      const key = `${recurring.id}:${monthKey(month)}`;
      if (have.has(key) || skipped.has(key)) continue;
      const date = dateInMonth(month, recurring.day);
      if (compareDates(date, today) < 0 || compareDates(date, horizon) > 0) continue;
      virtual.push({
        id: `v-${recurring.id}-${monthKey(date)}`,
        kind: recurring.kind,
        date,
        description: recurring.name,
        categoryId: recurring.categoryId,
        cents: recurring.cents,
        status: 'prevista',
        recurringId: recurring.id,
        payments: paymentsFor(recurring, recurring.cents),
      });
    }
  }
  return [...stored, ...virtual];
};

export type CashEventType = 'receita' | 'despesa' | 'fatura';

/** O que mexe na conta numa data, com o saldo em contas logo depois. */
export type CashEvent = {
  readonly id: string;
  readonly date: IsoDate;
  /** Com sinal: positivo entra, negativo sai. */
  readonly cents: Cents;
  readonly accountId: string;
  readonly type: CashEventType;
  readonly label: string;
  readonly categoryId?: string;
  readonly cardId?: string;
  /** Fatura (`AAAA-MM`) que este evento paga. */
  readonly invoice?: string;
  readonly balanceAfter: Cents;
};

type RawEvent = Omit<CashEvent, 'balanceAfter'>;

export type ProjectionDay = { readonly date: IsoDate; readonly cents: Cents };

export type ProjectionPeriod = {
  /** `AAAA-MM`. */
  readonly key: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly entradas: Cents;
  /** Positivo: despesas pagas direto da conta. */
  readonly despesas: Cents;
  /** Positivo: faturas pagas no período. */
  readonly faturas: Cents;
  /** `despesas + faturas`. */
  readonly saidas: Cents;
  /** Saldo em contas ao fim do período. */
  readonly endCents: Cents;
};

export type Projection = {
  readonly today: IsoDate;
  readonly horizon: IsoDate;
  readonly startCents: Cents;
  readonly endCents: Cents;
  readonly days: readonly ProjectionDay[];
  readonly events: readonly CashEvent[];
  readonly periods: readonly ProjectionPeriod[];
  /** O menor saldo ao fim de um dia, hoje inclusive; no empate, o primeiro dia. */
  readonly lowest: ProjectionDay;
  /** O último evento do dia do menor saldo, para marcar a linha. */
  readonly lowestEventId: string | undefined;
};

const RANK: Readonly<Record<CashEventType, number>> = {
  receita: 0,
  despesa: 1,
  fatura: 2,
};

/** O saldo em contas de hoje: toda conta ativa soma (RN-30, RN-38). */
export const startingBalance = (data: FinanceData, today: IsoDate): Cents =>
  sum(
    data.accounts
      .filter((account) => account.archived !== true)
      .map((account) => {
        const lines = accountLines(data, account.id, today);
        return lines.length === 0
          ? account.initialCents
          : (lines[lines.length - 1]?.balanceAfter ?? account.initialCents);
      }),
  );

const activeAccounts = (data: FinanceData): ReadonlySet<string> =>
  new Set(data.accounts.filter((account) => account.archived !== true).map((a) => a.id));

/** Quantos meses de faturas para trás ainda podem estar em aberto. */
const INVOICE_LOOKBACK = 6;

const entryEvents = (
  planned: readonly Entry[],
  accounts: ReadonlySet<string>,
  today: IsoDate,
  horizon: IsoDate,
): readonly RawEvent[] =>
  planned.flatMap((entry) => {
    const date = effectiveDate(entry, today);
    if (compareDates(date, horizon) > 0) return [];
    return entry.payments
      .filter((payment) => accounts.has(payment.sourceId))
      .map((payment, index): RawEvent => ({
        id: `${entry.id}:${index}`,
        date,
        cents: entry.kind === 'receita' ? payment.cents : -payment.cents,
        accountId: payment.sourceId,
        type: entry.kind,
        label: entry.description,
        categoryId: entry.categoryId,
      }));
  });

/**
 * Faturas em aberto que vencem até o horizonte, cada uma como uma saída da conta
 * pagadora no vencimento. Usa os mesmos totais da tela de Cartões (RN-44), já com
 * os previstos e as ocorrências virtuais dentro.
 */
const invoiceEvents = (
  data: FinanceData,
  planned: readonly Entry[],
  accounts: ReadonlySet<string>,
  today: IsoDate,
  horizon: IsoDate,
): readonly RawEvent[] => {
  const projected: FinanceData = {
    ...data,
    entries: [
      ...data.entries.filter(
        (entry) => !(entry.status === 'prevista' && entry.historical !== true),
      ),
      ...planned,
    ],
  };
  const events: RawEvent[] = [];
  for (const card of data.cards) {
    if (!accounts.has(card.payerId)) continue;
    const last = monthKey(horizon);
    for (
      let key = shiftInvoice(monthKey(today), -INVOICE_LOOKBACK);
      key <= last;
      key = shiftInvoice(key, 1)
    ) {
      const due = invoiceDue(card, key);
      if (compareDates(due, horizon) > 0) continue;
      if (paymentOf(data, card.id, key) !== undefined) continue;
      const total = invoiceTotal(projected, card, key);
      if (total <= 0) continue;
      events.push({
        id: `fatura:${card.id}:${key}`,
        date: compareDates(due, today) < 0 ? today : due,
        cents: -total,
        accountId: card.payerId,
        type: 'fatura',
        label: `Fatura ${card.name}`,
        cardId: card.id,
        invoice: key,
      });
    }
  }
  return events;
};

const periodsOf = (
  today: IsoDate,
  horizon: IsoDate,
  events: readonly CashEvent[],
  days: readonly ProjectionDay[],
): readonly ProjectionPeriod[] => {
  const periods: ProjectionPeriod[] = [];
  for (
    let from = today;
    compareDates(from, horizon) <= 0;
    from = addDays(endOfMonth(from), 1)
  ) {
    const monthEnd = endOfMonth(from);
    const to = compareDates(monthEnd, horizon) < 0 ? monthEnd : horizon;
    const inside = events.filter(
      (event) => compareDates(event.date, from) >= 0 && compareDates(event.date, to) <= 0,
    );
    const despesas = -sum(inside.filter((e) => e.type === 'despesa').map((e) => e.cents));
    const faturas = -sum(inside.filter((e) => e.type === 'fatura').map((e) => e.cents));
    periods.push({
      key: monthKey(from),
      from,
      to,
      entradas: sum(inside.filter((e) => e.type === 'receita').map((e) => e.cents)),
      despesas,
      faturas,
      saidas: despesas + faturas,
      endCents: days.find((day) => day.date === to)?.cents ?? 0,
    });
  }
  return periods;
};

/** Projeta o saldo em contas de `today` até `horizon`. */
export const projectBalance = (
  data: FinanceData,
  today: IsoDate,
  horizon: IsoDate,
): Projection => {
  const planned = plannedEntries(data, today, horizon);
  const accounts = activeAccounts(data);

  const raw = [
    ...entryEvents(planned, accounts, today, horizon),
    ...invoiceEvents(data, planned, accounts, today, horizon),
  ].sort(
    (a, b) =>
      compareDates(a.date, b.date) ||
      RANK[a.type] - RANK[b.type] ||
      a.id.localeCompare(b.id),
  );

  const startCents = startingBalance(data, today);
  let balance = startCents;
  const events: CashEvent[] = raw.map((event) => {
    balance += event.cents;
    return { ...event, balanceAfter: balance };
  });

  const days: ProjectionDay[] = [];
  let cursor = 0;
  let running = startCents;
  for (let date = today; compareDates(date, horizon) <= 0; date = addDays(date, 1)) {
    while (cursor < events.length && events[cursor]?.date === date) {
      running = events[cursor]?.balanceAfter ?? running;
      cursor += 1;
    }
    days.push({ date, cents: running });
  }

  const first = days[0] ?? { date: today, cents: startCents };
  const lowest = days.reduce((best, day) => (day.cents < best.cents ? day : best), first);
  const onLowest = events.filter((event) => event.date === lowest.date);

  return {
    today,
    horizon,
    startCents,
    endCents: days[days.length - 1]?.cents ?? startCents,
    days,
    events,
    periods: periodsOf(today, horizon, events, days),
    lowest,
    lowestEventId: onLowest[onLowest.length - 1]?.id,
  };
};

/**
 * O saldo em contas dia a dia, de `from` até hoje, a partir do extrato de cada
 * conta ativa: a parte realizada da linha do gráfico.
 */
export const realizedBalances = (
  data: FinanceData,
  from: IsoDate,
  today: IsoDate,
): readonly ProjectionDay[] => {
  const perAccount = data.accounts
    .filter((account) => account.archived !== true)
    .map((account) => ({
      initial: account.initialCents,
      lines: accountLines(data, account.id, today),
    }));
  const cursors = perAccount.map(() => 0);
  const balances = perAccount.map((account) => account.initial);
  const days: ProjectionDay[] = [];

  for (
    let date = compareDates(from, today) > 0 ? today : from;
    compareDates(date, today) <= 0;
    date = addDays(date, 1)
  ) {
    perAccount.forEach((account, index) => {
      let cursor = cursors[index] ?? 0;
      while (
        cursor < account.lines.length &&
        compareDates(account.lines[cursor]?.date ?? today, date) <= 0
      ) {
        balances[index] = account.lines[cursor]?.balanceAfter ?? balances[index] ?? 0;
        cursor += 1;
      }
      cursors[index] = cursor;
    });
    days.push({ date, cents: sum(balances) });
  }
  return days;
};

export type ProjectedMonth = {
  readonly key: string;
  readonly start: IsoDate;
  readonly receitas: Cents;
  readonly despesas: Cents;
};

/**
 * Receitas e despesas previstas, por mês de calendário, do mês de hoje até
 * `months` meses à frente. No mês de hoje é só o que falta acontecer. Despesa no
 * cartão conta no mês da compra, não no do pagamento da fatura (RN-46).
 */
export const projectedMonths = (
  data: FinanceData,
  today: IsoDate,
  months: number,
): readonly ProjectedMonth[] => {
  const horizon = endOfMonth(addMonths(today, months));
  const planned = plannedEntries(data, today, horizon);
  return Array.from({ length: months + 1 }, (_, index) => {
    const start = startOfMonth(addMonths(today, index));
    const inMonth = planned.filter(
      (entry) => monthKey(effectiveDate(entry, today)) === monthKey(start),
    );
    return {
      key: monthKey(start),
      start,
      receitas: sum(inMonth.filter((e) => e.kind === 'receita').map((e) => e.cents)),
      despesas: sum(inMonth.filter((e) => e.kind === 'despesa').map((e) => e.cents)),
    };
  });
};

/** Os eventos dos próximos `days` dias, de hoje em diante. */
export const upcomingEvents = (
  projection: Projection,
  days = 30,
): readonly CashEvent[] => {
  const until = addDays(projection.today, days);
  return projection.events.filter((event) => compareDates(event.date, until) <= 0);
};
