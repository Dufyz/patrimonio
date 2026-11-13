import type { BookResponse, BookRowResource } from '@patrimonio/contracts';

/**
 * LAN-01 · O que a tela Lançamentos decide sobre as linhas do livro.
 *
 * O valor vem sempre positivo e o sinal vem do tipo (RN-U1). Receita e
 * rendimentos entram (+); despesa e aporte saem (−); resgate e provento mudam
 * a posição, não o saldo do mês; transferência e evento não têm sinal.
 */
export type Sign = '+' | '-' | '';

const SIGN: Readonly<Record<BookRowResource['kind'], Sign>> = {
  RECEITA: '+',
  DESPESA: '-',
  APORTE: '-',
  PAGAMENTO_FATURA: '-',
  RESGATE: '+',
  PROVENTO: '+',
  TRANSFERENCIA: '',
  EVENTO: '',
};

export const signOf = (kind: BookRowResource['kind']): Sign => SIGN[kind];

const WEEKDAYS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
] as const;

/** `2026-11-11` → `Quarta, 11/11`. Sem fuso: a data é só calendário. */
export const dayLabel = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? '';
  return `${weekday}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};

export type DaySection = {
  readonly date: string;
  readonly label: string;
  readonly rows: readonly BookRowResource[];
};

/** Mais novo primeiro; a ordem das linhas dentro do dia é a do servidor. */
export const sectionsByDay = (
  rows: readonly BookRowResource[],
): readonly DaySection[] => {
  const byDate = new Map<string, BookRowResource[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({ date, label: dayLabel(date), rows: list }));
};

/** O que a linha soma ao saldo do mês: só lançado; aporte só se sai de conta. */
export const countsInBalance = (row: BookRowResource): boolean =>
  row.situation === 'lancado' &&
  row.amount !== null &&
  (row.kind === 'RECEITA' ||
    row.kind === 'DESPESA' ||
    (row.kind === 'APORTE' && row.account_id !== null));

const SCALE = 8;

const toScaled = (value: string): bigint => {
  const negative = value.startsWith('-');
  const [int = '0', frac = ''] = value.replace(/^[+-]/, '').split('.');
  const scaled = BigInt(int + frac.padEnd(SCALE, '0').slice(0, SCALE));
  return negative ? -scaled : scaled;
};

/** Soma assinada da coluna Valor das linhas lançadas que entram no saldo. */
export const postedBalance = (rows: readonly BookRowResource[]): bigint =>
  rows.reduce((sum, row) => {
    if (!countsInBalance(row) || row.amount === null) return sum;
    const value = toScaled(row.amount);
    return signOf(row.kind) === '-' ? sum - value : sum + value;
  }, 0n);

/** O `saldo_do_mes` do servidor na mesma escala, para conferir a soma. */
export const balanceOf = (book: Pick<BookResponse, 'totals'>): bigint =>
  toScaled(book.totals.saldo_do_mes);

export type PlannedSection = {
  readonly rows: readonly BookRowResource[];
  readonly overdue: number;
  /** "3 previstos · 1 vencido"; sem vencidos, só a contagem. */
  readonly counter: string;
};

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/** LAN-02 · Os previstos, do mais próximo ao mais distante; vencido é data < hoje. */
export const plannedSection = (
  rows: readonly BookRowResource[],
  today: string,
): PlannedSection => {
  const planned = rows
    .filter((r) => r.situation === 'previsto')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const overdue = planned.filter((r) => r.date < today).length;
  const base = plural(planned.length, 'previsto', 'previstos');
  return {
    rows: planned,
    overdue,
    counter: overdue === 0 ? base : `${base} · ${plural(overdue, 'vencido', 'vencidos')}`,
  };
};

/** "venceu em dd/mm" para o previsto cuja data já passou. */
export const overdueNote = (date: string, today: string): string | null =>
  date < today ? `venceu em ${date.slice(8)}/${date.slice(5, 7)}` : null;
