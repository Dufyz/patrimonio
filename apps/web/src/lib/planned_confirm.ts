/** LAN-06 · Valores do modal "Lançar previsto": estimado editável e data sugerida. */

/** Centavos ("150000") → decimal da API ("1500.00"), sem float. */
export const centsToDecimal = (cents: string): string => {
  const n = BigInt(cents);
  const abs = n < 0n ? -n : n;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${n < 0n ? '-' : ''}${whole}.${frac}`;
};

/** Aceita "1.500,25", "1500,25" ou "1500.25"; devolve decimal da API ou null. */
export const parseAmountInput = (text: string): string | null => {
  const t = text.trim().replace(/\s/g, '');
  const normalized = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [w = '0', f = ''] = normalized.split('.');
  const value = `${BigInt(w)}.${f.padEnd(2, '0')}`;
  return BigInt(w) === 0n && BigInt(f.padEnd(2, '0')) === 0n ? null : value;
};

/** A data do previsto, ou hoje se ela for futura. */
export const suggestedDate = (plannedDate: string, today: string): string =>
  plannedDate > today ? today : plannedDate;
