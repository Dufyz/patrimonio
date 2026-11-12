/** Minúsculas sem acento: "Cartão" e "cartao" são a mesma busca. */
export const fold = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Todas as palavras da busca aparecem em algum dos campos. */
export const matchesText = (
  query: string,
  fields: readonly (string | null | undefined)[],
): boolean => {
  const terms = fold(query)
    .split(/\s+/)
    .filter((term) => term !== '');
  if (terms.length === 0) return true;
  const haystack = fields.map((field) => fold(field ?? '')).join(' ');
  return terms.every((term) => haystack.includes(term));
};

/** "1.234,50", "1234.5", "R$ 12" → "1234.50"; texto que não é valor devolve `null`. */
export const looseAmount = (text: string): string | null => {
  const cleaned = text.trim().replace(/^R\$\s*/i, '');
  if (!/^[\d.,]+$/.test(cleaned) || !/\d/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalAt = Math.max(lastComma, lastDot);
  const digits = (value: string): string => value.replace(/[.,]/g, '');
  const hasDecimal =
    decimalAt >= 0 &&
    cleaned.length - decimalAt - 1 <= 2 &&
    (lastComma >= 0 || cleaned.split('.').length === 2);
  if (!hasDecimal) return `${digits(cleaned)}.00`;
  const whole = digits(cleaned.slice(0, decimalAt)) || '0';
  const fraction = digits(cleaned.slice(decimalAt + 1)).padEnd(2, '0');
  return `${whole}.${fraction}`;
};
