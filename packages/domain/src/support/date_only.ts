/**
 * Data de negócio é `date` no Postgres e string `YYYY-MM-DD` no código, nunca
 * `Date` com fuso: um `Date` de "2024-03-10" em São Paulo é 09/03 em UTC, e
 * esse deslocamento de um dia reaparece no fechamento, no dia útil e na curva.
 */
export type DateOnly = string;

const PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isDateOnly = (value: unknown): value is DateOnly =>
  typeof value === 'string' && PATTERN.test(value) && !Number.isNaN(Date.parse(value));

/**
 * Converte o que o driver devolveu para `YYYY-MM-DD`. O `postgres` entrega
 * `date` como string, e é assim que fica; um `Date` só aparece aqui se alguém
 * configurar o driver de outro jeito, e aí a conversão é em UTC.
 */
export const toDateOnly = (value: Date | string): DateOnly => {
  if (typeof value === 'string') {
    const trimmed = value.slice(0, 10);
    if (!isDateOnly(trimmed)) throw new TypeError(`data inválida: ${value}`);
    return trimmed;
  }

  return value.toISOString().slice(0, 10);
};

/** Soma dias corridos. Dia útil é consulta a `business_day`, não aritmética. */
export const addDays = (date: DateOnly, days: number): DateOnly => {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

export const compareDateOnly = (left: DateOnly, right: DateOnly): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const minDateOnly = (left: DateOnly, right: DateOnly): DateOnly =>
  left <= right ? left : right;
