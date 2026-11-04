import { addDays, compareDates } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { formatBRL } from '../lib/format.js';
import { sum } from '../lib/money.js';
import type { Cents } from '../lib/money.js';
import type { DateRange } from '../lib/period.js';
import { CARDS, sourceName } from './sources.js';
import type { Account, Entry, FinanceData, MovementKind } from './types.js';

/**
 * Contas e extratos (FIN-401 a FIN-409).
 *
 * O saldo de uma conta é o inicial mais as movimentações (RN-31): a parte de
 * cada lançamento lançado que a conta pagou ou recebeu, mais as movimentações
 * próprias (transferência, fatura, crédito, ajuste). Tudo é função pura sobre
 * `FinanceData`; nenhuma tela guarda saldo.
 */

export type LineOrigin = 'lancamento' | MovementKind;

/** Uma linha do extrato: o que uma conta viu entrar ou sair. */
export type StatementLine = {
  readonly id: string;
  readonly date: IsoDate;
  readonly origin: LineOrigin;
  readonly description: string;
  /** Segunda linha da descrição ("saldo livre do mês"). */
  readonly note?: string;
  readonly categoryId?: string;
  /** Com sinal: positivo entra, negativo sai. */
  readonly cents: Cents;
  /** Etiquetas de natureza: recorrente, 2 pagamentos, fatura, transferência... */
  readonly tags: readonly string[];
  readonly entryId?: string;
};

export type PostedLine = StatementLine & { readonly balanceAfter: Cents };

const ORIGIN_TAG: Readonly<Record<MovementKind, string>> = {
  transferencia: 'transferência',
  fatura: 'fatura',
  credito: 'crédito',
  ajuste: 'ajuste',
};

export const findAccount = (data: FinanceData, id: string): Account | undefined =>
  data.accounts.find((account) => account.id === id);

export const accountLabel = (data: FinanceData, id: string): string =>
  findAccount(data, id)?.name ?? sourceName(data, id);

const isCard = (sourceId: string): boolean => CARDS.some((card) => card.id === sourceId);

const entryNote = (
  data: FinanceData,
  entry: Entry,
  accountId: string,
): string | undefined => {
  if (entry.payments.length < 2) return undefined;
  const others = entry.payments
    .filter((payment) => payment.sourceId !== accountId)
    .map(
      (payment) =>
        `${formatBRL(payment.cents)} ${entry.kind === 'receita' ? 'entraram' : 'saíram'} ${
          entry.kind === 'receita' ? 'em' : 'do'
        } ${accountLabel(data, payment.sourceId)}`,
    );
  return `parte da conta · ${others.join(' · ')}`;
};

const entryTags = (entry: Entry): readonly string[] => [
  ...(entry.recurringId === undefined ? [] : ['recorrente']),
  ...(entry.payments.length > 1 ? [`${entry.payments.length} pagamentos`] : []),
];

/** Ordem no mesmo dia: receitas, despesas e então as movimentações (desempate estável). */
const dayRank = (line: StatementLine, entryKind?: Entry['kind']): number =>
  line.origin !== 'lancamento' ? 2 : entryKind === 'receita' ? 0 : 1;

/**
 * Todas as linhas já ocorridas de uma conta, em ordem cronológica e com o saldo
 * após cada uma. Previsto e compra no cartão não entram: o cartão só mexe na
 * conta quando a fatura é paga (RN-32).
 */
export const accountLines = (
  data: FinanceData,
  accountId: string,
  today: IsoDate,
): readonly PostedLine[] => {
  const account = findAccount(data, accountId);
  if (account === undefined) return [];

  type Ranked = { line: StatementLine; rank: number; order: number };
  const ranked: Ranked[] = [];
  let order = 0;

  for (const entry of data.entries) {
    if (entry.historical === true || entry.status !== 'lancada') continue;
    if (compareDates(entry.date, today) > 0) continue;
    const payment = entry.payments.find((p) => p.sourceId === accountId);
    if (payment === undefined) continue;
    const note = entryNote(data, entry, accountId);
    const line: StatementLine = {
      id: `${entry.id}:${accountId}`,
      date: entry.date,
      origin: 'lancamento',
      description: entry.description,
      ...(note === undefined ? {} : { note }),
      categoryId: entry.categoryId,
      cents: entry.kind === 'receita' ? payment.cents : -payment.cents,
      tags: entryTags(entry),
      entryId: entry.id,
    };
    ranked.push({ line, rank: dayRank(line, entry.kind), order: order++ });
  }

  for (const movement of data.movements) {
    if (movement.accountId !== accountId || compareDates(movement.date, today) > 0)
      continue;
    const line: StatementLine = {
      id: movement.id,
      date: movement.date,
      origin: movement.kind,
      description: movement.description,
      ...(movement.note === undefined ? {} : { note: movement.note }),
      cents: movement.cents,
      tags: [ORIGIN_TAG[movement.kind]],
    };
    ranked.push({ line, rank: 2, order: order++ });
  }

  ranked.sort(
    (a, b) =>
      compareDates(a.line.date, b.line.date) || a.rank - b.rank || a.order - b.order,
  );

  let balance = account.initialCents;
  return ranked.map(({ line }) => {
    balance += line.cents;
    return { ...line, balanceAfter: balance };
  });
};

/** O saldo da conta em `today` (RN-31). */
export const accountBalance = (
  data: FinanceData,
  accountId: string,
  today: IsoDate,
): Cents => {
  const account = findAccount(data, accountId);
  if (account === undefined) return 0;
  return (
    account.initialCents + sum(accountLines(data, accountId, today).map((l) => l.cents))
  );
};

export type Statement = {
  /** Saldo na abertura do período (antes da primeira linha dele). */
  readonly opening: Cents;
  readonly entered: Cents;
  readonly left: Cents;
  /** Saldo ao fim do período, limitado a hoje. */
  readonly closing: Cents;
  readonly lines: readonly PostedLine[];
  /** O último dia contado: o fim do período ou hoje, o que vier antes. */
  readonly through: IsoDate;
};

/** O extrato de uma conta num período: saldo de abertura, entradas, saídas e linhas. */
export const statement = (
  data: FinanceData,
  accountId: string,
  range: DateRange,
  today: IsoDate,
): Statement => {
  const account = findAccount(data, accountId);
  const through = compareDates(range.to, today) < 0 ? range.to : today;
  const all = accountLines(data, accountId, through);
  const before = all.filter((line) => compareDates(line.date, range.from) < 0);
  const lines = all.filter((line) => compareDates(line.date, range.from) >= 0);
  const opening =
    before.length > 0
      ? (before[before.length - 1]?.balanceAfter ?? 0)
      : (account?.initialCents ?? 0);
  const entered = sum(lines.filter((l) => l.cents > 0).map((l) => l.cents));
  const left = -sum(lines.filter((l) => l.cents < 0).map((l) => l.cents));
  return {
    opening,
    entered,
    left,
    closing:
      lines.length > 0 ? (lines[lines.length - 1]?.balanceAfter ?? opening) : opening,
    lines,
    through,
  };
};

export type AccountRow = {
  readonly account: Account;
  readonly balance: Cents;
  /** Saldo menos o de abertura do período. */
  readonly variation: Cents;
  /** Os cartões que esta conta paga. */
  readonly cards: readonly string[];
};

export type AccountsOverview = {
  readonly accounts: readonly AccountRow[];
  readonly benefits: readonly AccountRow[];
  readonly totalBalance: Cents;
  readonly totalVariation: Cents;
};

/** FIN-401: a tabela de Contas, com o total que só soma contas (RN-30). */
export const accountsOverview = (
  data: FinanceData,
  range: DateRange,
  today: IsoDate,
  showArchived = false,
): AccountsOverview => {
  const rows = data.accounts
    .filter((account) => showArchived || account.archived !== true)
    .map((account): AccountRow => {
      const stmt = statement(data, account.id, range, today);
      return {
        account,
        balance: accountBalance(data, account.id, today),
        variation: stmt.closing - stmt.opening,
        cards: CARDS.filter((card) => card.payerId === account.id).map(
          (card) => card.name,
        ),
      };
    });
  const accounts = rows.filter((row) => row.account.type === 'conta');
  const counted = accounts.filter((row) => row.account.archived !== true);
  return {
    accounts,
    benefits: rows.filter((row) => row.account.type === 'beneficio'),
    // RN-38: conta arquivada, mesmo exibida, não entra no total em contas.
    totalBalance: sum(counted.map((row) => row.balance)),
    totalVariation: sum(counted.map((row) => row.variation)),
  };
};

export type RecentMovement = {
  readonly id: string;
  readonly date: IsoDate;
  readonly description: string;
  readonly categoryId?: string;
  /** "Flex + Itaú Corrente" quando duas origens pagam. */
  readonly accountLabel: string;
  readonly tags: readonly string[];
  readonly cents: Cents;
};

/**
 * FIN-402: as movimentações mais recentes de todas as contas, da mais nova para
 * a mais antiga. Lançamento com duas origens aparece uma vez, com o valor total;
 * a transferência aparece uma vez, pela perna de saída.
 */
export const recentMovements = (
  data: FinanceData,
  today: IsoDate,
  limit = 8,
): readonly RecentMovement[] => {
  type Item = RecentMovement & { readonly rank: number; readonly order: number };
  const items: Item[] = [];
  let order = 0;

  for (const entry of data.entries) {
    if (entry.historical === true || entry.status !== 'lancada') continue;
    if (compareDates(entry.date, today) > 0) continue;
    const accountParts = entry.payments.filter((p) => !isCard(p.sourceId));
    if (accountParts.length === 0) continue;
    items.push({
      id: entry.id,
      date: entry.date,
      description: entry.description,
      categoryId: entry.categoryId,
      accountLabel: accountParts.map((p) => accountLabel(data, p.sourceId)).join(' + '),
      tags: entryTags(entry),
      cents: entry.kind === 'receita' ? entry.cents : -entry.cents,
      rank: entry.kind === 'receita' ? 0 : 1,
      order: order++,
    });
  }

  for (const movement of data.movements) {
    if (compareDates(movement.date, today) > 0) continue;
    if (movement.transferId !== undefined && movement.cents > 0) continue;
    items.push({
      id: movement.id,
      date: movement.date,
      description: movement.description,
      accountLabel: accountLabel(data, movement.accountId),
      tags: [ORIGIN_TAG[movement.kind]],
      cents: movement.cents,
      rank: 2,
      order: order++,
    });
  }

  items.sort(
    (a, b) => compareDates(b.date, a.date) || b.rank - a.rank || b.order - a.order,
  );
  return items.slice(0, limit).map(({ rank: _rank, order: _order, ...rest }) => rest);
};

/**
 * FIN-405: saldo inicial + entradas − saídas precisa ser igual ao saldo atual.
 * O Extrato nunca mostra números que não fecham: se divergir, mostra o erro.
 */
export const statementCloses = (stmt: Statement): boolean =>
  stmt.opening + stmt.entered - stmt.left === stmt.closing;

/** Tipo, instituição e cartão vinculado: "Conta corrente · Itaú Unibanco · cartão Itaú Visa". */
export const accountSubtitle = (account: Account): string => {
  const kind =
    account.type === 'beneficio'
      ? 'Benefício'
      : account.institution === undefined
        ? 'Conta'
        : 'Conta corrente';
  const cards = CARDS.filter((card) => card.payerId === account.id).map(
    (card) => `cartão ${card.name}`,
  );
  return [kind, account.institution, ...cards]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');
};

export type DailyBalance = { readonly date: IsoDate; readonly cents: Cents };

/**
 * FIN-406: um ponto por dia, do início do período até o fim dele ou hoje, o que
 * vier antes. O saldo do dia é o saldo após a última movimentação do dia; sem
 * movimentação, repete o do dia anterior (e o de abertura no primeiro dia).
 */
export const dailyBalances = (
  data: FinanceData,
  accountId: string,
  range: DateRange,
  today: IsoDate,
): readonly DailyBalance[] => {
  const stmt = statement(data, accountId, range, today);
  const lastOfDay = new Map<IsoDate, Cents>();
  for (const line of stmt.lines) lastOfDay.set(line.date, line.balanceAfter);

  const points: DailyBalance[] = [];
  let balance = stmt.opening;
  for (
    let date = range.from;
    compareDates(date, stmt.through) <= 0;
    date = addDays(date, 1)
  ) {
    balance = lastOfDay.get(date) ?? balance;
    points.push({ date, cents: balance });
  }
  return points;
};
