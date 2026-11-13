import type { ProjectionResource } from '@patrimonio/contracts';

/**
 * PRJ-02..08 · O que a tela de Projeção decide sem navegador. Nenhuma conta
 * financeira: série, KPIs e valor no horizonte chegam do motor. O que há aqui
 * é forma — horizonte na URL, texto digitado vira decimal, aporte do mês como a
 * diferença de dois acumulados (inteiros em centavos, nunca ponto flutuante).
 */
export const HORIZONS = [
  { value: 12, label: '12 meses' },
  { value: 24, label: '2 anos' },
  { value: 36, label: '3 anos' },
  { value: 60, label: '5 anos' },
] as const;

export const DEFAULT_HORIZON = 24;

export const horizonFromParam = (raw: string | null): number => {
  const value = Number(raw);
  return HORIZONS.some((item) => item.value === value) ? value : DEFAULT_HORIZON;
};

/** `13,75` → `13.75`; vazio é `null` (sem rentabilidade); inválido é `undefined`. */
export const parseReturnText = (text: string): string | null | undefined => {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= 0 && value <= 100 ? value.toFixed(2) : undefined;
};

export const returnText = (value: string | null): string =>
  value === null ? '' : value.replace('.', ',');

/** `1.000,50` ou `1000.5` → `1000.50`; inválido ou ≤ 0 é `undefined`. */
export const parseAmountText = (text: string): string | undefined => {
  const cleaned = text.trim().replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  const [whole = '0', cents = ''] = cleaned.split('.');
  const normalized = `${whole}.${cents.padEnd(2, '0')}`;
  return Number(normalized) > 0 ? normalized : undefined;
};

export const toCents = (decimal: string): bigint => {
  const negative = decimal.startsWith('-');
  const [whole = '0', cents = ''] = decimal.replace('-', '').split('.');
  const value = BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0').slice(0, 2));
  return negative ? -value : value;
};

export const fromCents = (cents: bigint): string => {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const text = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
};

type Result = NonNullable<ProjectionResource['total']>;

/** O aporte de cada mês: diferença entre acumulados consecutivos. */
export const monthlyContributions = (result: Result): readonly string[] =>
  result.series.map((point, index) => {
    const previous = result.series[index - 1];
    return fromCents(
      toCents(point.contributions_cumulative) -
        (previous === undefined ? 0n : toCents(previous.contributions_cumulative)),
    );
  });

/** A soma das regras ativas num mês `YYYY-MM`: o aporte mensal da coluna da tabela. */
export const rulesAmountAt = (
  rules: readonly { amount: string; from: string; until: string | null }[],
  month: string,
): string =>
  fromCents(
    rules.reduce(
      (sum, rule) =>
        month >= rule.from && (rule.until === null || month <= rule.until)
          ? sum + toCents(rule.amount)
          : sum,
      0n,
    ),
  );

export const MONTH_NAMES = [
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
] as const;

/** `2026-11` → `nov/2026`. */
export const monthLabel = (month: string): string => {
  const [year = '', m = '1'] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? m}/${year}`;
};
