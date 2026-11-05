import type {
  FinAccount,
  FinEntry,
  FinMovementKind,
  FinSnapshot,
} from '@patrimonio/domain';
import type { Decimal } from 'decimal.js';

import { addDays, compareDates, isDateInRange } from './dates.js';
import type { DateRange } from './dates.js';
import { dec, money, total, ZERO } from './money.js';
import { findAccount, findCard } from './lookup.js';

/**
 * Contas e extratos. O saldo de uma conta é o inicial mais as movimentações
 * (RN-31): a parte de cada lançamento lançado que a conta pagou ou recebeu, as
 * movimentações próprias (transferência, crédito, ajuste) e os pagamentos de
 * fatura. Previsto e compra no cartão não entram — o cartão só mexe na conta
 * quando a fatura é paga (RN-32). Lançamentos anteriores à data de abertura da
 * conta já estão contidos no saldo inicial e ficam de fora.
 *
 * Tudo é função pura sobre `FinSnapshot`; nenhuma coluna guarda saldo (T-02).
 */

export type LineOrigin = 'lancamento' | 'fatura' | FinMovementKind;

export type StatementLine = {
  readonly id: string;
  readonly date: string;
  readonly origin: LineOrigin;
  readonly description: string;
  readonly note: string | null;
  readonly category_id: string | null;
  /** Com sinal: positivo entra, negativo sai. */
  readonly amount: string;
  readonly tags: readonly string[];
  readonly entry_id: string | null;
  /** O saldo da conta depois desta linha. */
  readonly balance_after: string;
};

type RawLine = Omit<StatementLine, 'balance_after' | 'amount'> & {
  readonly value: Decimal;
};

const ORIGIN_TAG: Readonly<Record<FinMovementKind, string>> = {
  transferencia_entrada: 'transferência',
  transferencia_saida: 'transferência',
  ajuste: 'ajuste',
};

const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** "Pagamento da fatura Itaú Visa (set)": o mês é o do vencimento. */
export const invoicePaymentDescription = (
  data: FinSnapshot,
  cardId: string,
  invoiceMonth: string,
): string => {
  const month = MONTHS[Number(invoiceMonth.slice(5, 7)) - 1] ?? '';
  return `Pagamento da fatura ${findCard(data, cardId)?.name ?? cardId} (${month})`;
};

const accountLabel = (data: FinSnapshot, id: string): string =>
  findAccount(data, id)?.name ?? findCard(data, id)?.name ?? id;

const entryNote = (
  data: FinSnapshot,
  entry: FinEntry,
  accountId: string,
): string | null => {
  if (entry.payments.length < 2) return null;
  const others = entry.payments
    .filter((payment) => payment.source_id !== accountId)
    .map(
      (payment) =>
        `${payment.amount} ${entry.kind === 'receita' ? 'entraram em' : 'saíram de'} ${accountLabel(data, payment.source_id)}`,
    );
  return `parte da conta · ${others.join(' · ')}`;
};

const entryTags = (entry: FinEntry): readonly string[] => [
  ...(entry.recurring_id === null ? [] : ['recorrente']),
  ...(entry.payments.length > 1 ? [`${entry.payments.length} pagamentos`] : []),
];

/** Todas as linhas já ocorridas de uma conta, em ordem cronológica, sem saldo. */
const rawLines = (
  data: FinSnapshot,
  account: FinAccount,
  today: string,
): readonly { line: RawLine; rank: number; order: number }[] => {
  const ranked: { line: RawLine; rank: number; order: number }[] = [];
  let order = 0;
  const counts = (date: string): boolean =>
    compareDates(date, today) <= 0 && compareDates(date, account.opening_date) >= 0;

  for (const entry of data.entries) {
    if (entry.status !== 'lancada' || !counts(entry.date)) continue;
    const payment = entry.payments.find(
      (p) => p.source_type === 'conta' && p.source_id === account.id,
    );
    if (payment === undefined) continue;
    const value = dec(payment.amount);
    ranked.push({
      line: {
        id: `${entry.id}:${account.id}`,
        date: entry.date,
        origin: 'lancamento',
        description: entry.description,
        note: entryNote(data, entry, account.id),
        category_id: entry.category_id,
        value: entry.kind === 'receita' ? value : value.neg(),
        tags: entryTags(entry),
        entry_id: entry.id,
      },
      rank: entry.kind === 'receita' ? 0 : 1,
      order: order++,
    });
  }

  for (const movement of data.movements) {
    if (movement.account_id !== account.id || !counts(movement.date)) continue;
    ranked.push({
      line: {
        id: movement.id,
        date: movement.date,
        origin: movement.kind,
        description: movement.description,
        note: movement.note,
        category_id: null,
        value: dec(movement.amount),
        tags: [ORIGIN_TAG[movement.kind]],
        entry_id: null,
      },
      rank: 2,
      order: order++,
    });
  }

  for (const payment of data.invoice_payments) {
    if (payment.account_id !== account.id || !payment.posted || !counts(payment.date))
      continue;
    ranked.push({
      line: {
        id: payment.id,
        date: payment.date,
        origin: 'fatura',
        description: invoicePaymentDescription(
          data,
          payment.card_id,
          payment.invoice_month,
        ),
        note: null,
        category_id: null,
        value: dec(payment.amount).neg(),
        tags: ['fatura'],
        entry_id: null,
      },
      rank: 2,
      order: order++,
    });
  }

  return ranked.sort(
    (a, b) =>
      compareDates(a.line.date, b.line.date) || a.rank - b.rank || a.order - b.order,
  );
};

/** As linhas de uma conta até `today`, com o saldo corrente após cada uma. */
export const accountLines = (
  data: FinSnapshot,
  accountId: string,
  today: string,
): readonly StatementLine[] => {
  const account = findAccount(data, accountId);
  if (account === undefined) return [];

  let balance = dec(account.opening_amount);
  return rawLines(data, account, today).map(({ line }) => {
    balance = balance.plus(line.value);
    const { value, ...rest } = line;
    return { ...rest, amount: money(value), balance_after: money(balance) };
  });
};

export const accountBalance = (
  data: FinSnapshot,
  accountId: string,
  today: string,
): Decimal => {
  const account = findAccount(data, accountId);
  if (account === undefined) return ZERO;
  return total(rawLines(data, account, today).map(({ line }) => line.value)).plus(
    account.opening_amount,
  );
};

export type Statement = {
  /** Saldo na abertura do período (antes da primeira linha dele). */
  readonly opening: string;
  readonly entered: string;
  readonly left: string;
  /** Saldo ao fim do período, limitado a hoje. */
  readonly closing: string;
  readonly lines: readonly StatementLine[];
  /** O último dia contado: o fim do período ou hoje, o que vier antes. */
  readonly through: string;
};

/** O extrato de uma conta num período. Abertura + entradas − saídas = fechamento, sempre. */
export const statement = (
  data: FinSnapshot,
  accountId: string,
  range: DateRange,
  today: string,
): Statement => {
  const account = findAccount(data, accountId);
  const through = compareDates(range.to, today) < 0 ? range.to : today;
  const all = accountLines(data, accountId, through);
  const before = all.filter((line) => compareDates(line.date, range.from) < 0);
  const lines = all.filter((line) => compareDates(line.date, range.from) >= 0);
  const opening = before.at(-1)?.balance_after ?? account?.opening_amount ?? '0.00';
  const entered = total(
    lines.filter((l) => dec(l.amount).gt(0)).map((l) => dec(l.amount)),
  );
  const left = total(
    lines.filter((l) => dec(l.amount).lt(0)).map((l) => dec(l.amount)),
  ).neg();
  return {
    opening: money(dec(opening)),
    entered: money(entered),
    left: money(left),
    closing: lines.at(-1)?.balance_after ?? money(dec(opening)),
    lines,
    through,
  };
};

export const statementCloses = (stmt: Statement): boolean =>
  dec(stmt.opening).plus(stmt.entered).minus(stmt.left).eq(stmt.closing);

export type AccountRow = {
  readonly account: FinAccount;
  readonly balance: string;
  /** Saldo de fechamento menos o de abertura do período. */
  readonly variation: string;
  /** Os cartões que esta conta paga. */
  readonly cards: readonly string[];
};

export type AccountsOverview = {
  readonly accounts: readonly AccountRow[];
  /** RN-30: o total "em contas" só soma contas ativas — arquivada fica fora. */
  readonly total_balance: string;
  readonly total_variation: string;
};

export const accountsOverview = (
  data: FinSnapshot,
  range: DateRange,
  today: string,
  showArchived = false,
): AccountsOverview => {
  const rows = data.accounts
    .filter((account) => showArchived || !account.archived)
    .map((account): AccountRow => {
      const stmt = statement(data, account.id, range, today);
      return {
        account,
        balance: money(accountBalance(data, account.id, today)),
        variation: money(dec(stmt.closing).minus(stmt.opening)),
        cards: data.cards
          .filter((card) => card.pay_account_id === account.id)
          .map((c) => c.name),
      };
    });
  const counted = rows.filter((row) => !row.account.archived);
  return {
    accounts: rows,
    total_balance: money(total(counted.map((row) => dec(row.balance)))),
    total_variation: money(total(counted.map((row) => dec(row.variation)))),
  };
};

/** O total "em contas" hoje: a soma dos saldos das contas ativas. */
export const totalInAccounts = (data: FinSnapshot, today: string): Decimal =>
  total(
    data.accounts
      .filter((account) => !account.archived)
      .map((account) => accountBalance(data, account.id, today)),
  );

export type DailyBalance = { readonly date: string; readonly balance: string };

/** Um ponto por dia, do início do período até o fim dele ou hoje, o que vier antes. */
export const dailyBalances = (
  data: FinSnapshot,
  accountId: string,
  range: DateRange,
  today: string,
): readonly DailyBalance[] => {
  const stmt = statement(data, accountId, range, today);
  const lastOfDay = new Map<string, string>();
  for (const line of stmt.lines) lastOfDay.set(line.date, line.balance_after);

  const points: DailyBalance[] = [];
  let balance = stmt.opening;
  for (
    let date = range.from;
    compareDates(date, stmt.through) <= 0;
    date = addDays(date, 1)
  ) {
    balance = lastOfDay.get(date) ?? balance;
    points.push({ date, balance });
  }
  return points;
};

/** Total "em contas" ao fim de cada dia do período: a série da visão geral. */
export const dailyTotalInAccounts = (
  data: FinSnapshot,
  range: DateRange,
  today: string,
): readonly DailyBalance[] => {
  const series = data.accounts
    .filter((account) => !account.archived)
    .map((account) => dailyBalances(data, account.id, range, today));
  const first = series[0] ?? [];
  return first.map((point, index) => ({
    date: point.date,
    balance: money(total(series.map((s) => dec(s[index]?.balance ?? '0')))),
  }));
};

export { isDateInRange };
