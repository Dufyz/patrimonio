import type {
  AccountStatementResource,
  StatementLineResource,
} from '../api/statement_view.js';

/**
 * CTA-02 · O que o Extrato decide sobre as linhas que o servidor entrega.
 */
const SCALE = 8;

const scaled = (value: string): bigint => {
  const negative = value.startsWith('-');
  const [int = '0', frac = ''] = value.replace(/^[+-]/, '').split('.');
  const out = BigInt(int + frac.padEnd(SCALE, '0').slice(0, SCALE));
  return negative ? -out : out;
};

/** Saldo inicial + entradas − saídas = saldo final; se não fechar, a tela não mostra números. */
export const statementCloses = (
  s: Pick<AccountStatementResource, 'opening' | 'entered' | 'left' | 'closing'>,
): boolean =>
  scaled(s.opening) + scaled(s.entered) - scaled(s.left) === scaled(s.closing);

/** Da mais nova à mais antiga; o saldo após foi calculado em ordem cronológica. */
export const newestFirst = (
  lines: readonly StatementLineResource[],
): readonly StatementLineResource[] => [...lines].reverse();

const TYPE_LABEL: Readonly<Record<string, string>> = {
  lancamento: 'Lançamento',
  fatura: 'Fatura',
  transferencia_entrada: 'Transferência',
  transferencia_saida: 'Transferência',
  ajuste: 'Ajuste',
  aporte: 'Aporte',
  resgate: 'Resgate',
  provento: 'Provento',
};

export const typeLabel = (line: StatementLineResource): string =>
  line.origin === 'lancamento'
    ? scaled(line.amount) >= 0n
      ? 'Receita'
      : 'Despesa'
    : (TYPE_LABEL[line.origin] ?? line.origin);

/** "saldo de 01/11 · entrou R$ x · saiu R$ y". */
export const dayMonth = (iso: string): string => `${iso.slice(8)}/${iso.slice(5, 7)}`;

/** Compara dois valores monetários em texto sem passar por ponto flutuante. */
export const compareMoney = (a: string, b: string): number => {
  const x = scaled(a);
  const y = scaled(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

const unscaled = (value: bigint): string => {
  const negative = value < 0n;
  const abs = (negative ? -value : value).toString().padStart(SCALE + 1, '0');
  const int = abs.slice(0, -SCALE);
  const frac = abs.slice(-SCALE).replace(/0+$/, '').padEnd(2, '0');
  return `${negative ? '-' : ''}${int}.${frac}`;
};

/** A soma das linhas, com sinal, em texto decimal. */
export const sumAmounts = (lines: readonly StatementLineResource[]): string =>
  unscaled(lines.reduce((acc, l) => acc + scaled(l.amount), 0n));

export type StatementType =
  'receita' | 'despesa' | 'transferencia' | 'fatura' | 'aporte' | 'resgate' | 'provento';

export const STATEMENT_TYPES: readonly { id: StatementType; label: string }[] = [
  { id: 'receita', label: 'Receita' },
  { id: 'despesa', label: 'Despesa' },
  { id: 'transferencia', label: 'Transferência' },
  { id: 'fatura', label: 'Fatura' },
  { id: 'aporte', label: 'Aporte' },
  { id: 'resgate', label: 'Resgate' },
  { id: 'provento', label: 'Provento' },
];

export const typeOf = (line: StatementLineResource): StatementType | null => {
  if (line.origin === 'lancamento')
    return scaled(line.amount) >= 0n ? 'receita' : 'despesa';
  if (line.origin.startsWith('transferencia')) return 'transferencia';
  if (
    line.origin === 'fatura' ||
    line.origin === 'aporte' ||
    line.origin === 'resgate' ||
    line.origin === 'provento'
  )
    return line.origin;
  return null;
};

/** Busca por descrição ou valor ("1.234,56", "1234.56" ou parte dele). */
export const matchesQuery = (line: StatementLineResource, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (line.description.toLowerCase().includes(q)) return true;
  const digits = q.replace(/\./g, '').replace(',', '.');
  const abs = line.amount.replace(/^[+-]/, '');
  return /^\d+(\.\d*)?$/.test(digits) && abs.includes(digits);
};

/**
 * O saldo após de cada linha vem do servidor e não muda com filtro ou busca:
 * filtrar só esconde linhas.
 */
export const filterLines = (
  lines: readonly StatementLineResource[],
  query: string,
  types: readonly StatementType[],
): readonly StatementLineResource[] =>
  lines.filter((l) => {
    if (!matchesQuery(l, query)) return false;
    if (types.length === 0) return true;
    const t = typeOf(l);
    return t !== null && types.includes(t);
  });

export type DailyPoint = {
  readonly date: string;
  readonly balance: string;
  /** Depois de hoje: o trecho previsto, tracejado. */
  readonly projected: boolean;
};

const addDay = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * CTA-03 · Um ponto por dia. O saldo do dia é o saldo após a última
 * movimentação do dia; sem movimento, o do dia anterior (ou o inicial).
 */
export const dailySeries = (
  s: Pick<AccountStatementResource, 'opening' | 'range' | 'lines'>,
  today: string,
): readonly DailyPoint[] => {
  const lastOfDay = new Map<string, string>();
  for (const line of s.lines) lastOfDay.set(line.date, line.balance_after);
  const out: DailyPoint[] = [];
  let balance = s.opening;
  for (let d = s.range.from; d <= s.range.to; d = addDay(d)) {
    balance = lastOfDay.get(d) ?? balance;
    out.push({ date: d, balance, projected: d > today });
  }
  return out;
};

export const lowestPoint = (points: readonly DailyPoint[]): DailyPoint | null =>
  points.reduce<DailyPoint | null>(
    (low, p) => (low === null || compareMoney(p.balance, low.balance) < 0 ? p : low),
    null,
  );
