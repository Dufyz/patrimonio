/**
 * RN-65 · Todo valor de Finanças é um inteiro em centavos.
 *
 * Receita é positiva e despesa é negativa quando o valor viaja com sinal. Não há
 * ponto flutuante no caminho: a soma de uma lista exibida é sempre igual ao
 * total exibido, sem diferença de um centavo.
 */

export type Cents = number;

export const sum = (values: readonly Cents[]): Cents =>
  values.reduce((total, value) => total + value, 0);

/**
 * Centavos como texto decimal, no formato que os componentes de número do
 * restante da aplicação consomem: `-450000` → `"-4500.00"`.
 */
export const centsToDecimal = (cents: Cents): string => {
  const negative = cents < 0;
  const absolute = Math.abs(Math.trunc(cents));
  const whole = Math.trunc(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
};

/** `"4500.00"` → `450000`. Texto sem exatamente duas casas é recusado. */
export const decimalToCents = (decimal: string): Cents | null => {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(decimal.trim());
  if (match === null) return null;
  const [, sign, whole, fraction = ''] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return sign === '-' ? -cents : cents;
};

/**
 * RN-45 · Divide em `parts` partes iguais, com o resto de centavos na primeira.
 * `300000` em 6 → `[50000 × 6]`; `10000` em 3 → `[3334, 3333, 3333]`.
 */
export const splitInstallments = (total: Cents, parts: number): readonly Cents[] => {
  if (!Number.isInteger(parts) || parts < 1) return [total];
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, index) =>
    index === 0 ? base + remainder : base,
  );
};
