/**
 * Os ajudantes que todo `parseXFromDB` usa. A cópia continua campo a campo —
 * coluna nova no `SELECT *` não vaza para a API sem alguém escrever a linha —
 * e estes ajudantes só tiram a repetição de conferir nulo e tipo.
 *
 * `NUMERIC` fica como string de propósito: `numeric(20,8)` não cabe em
 * `double`, e o cálculo acontece em `decimal.js` dentro de `calc`.
 */
import { isDateOnly, toDateOnly } from './date_only.js';
import type { DateOnly } from './date_only.js';

export type Row = Record<string, unknown>;

const missing = (column: string, value: unknown): never => {
  throw new TypeError(`coluna ${column} com valor inesperado: ${String(value)}`);
};

export const asString = (row: Row, column: string): string => {
  const value = row[column];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return missing(column, value);
};

export const asStringOrNull = (row: Row, column: string): string | null => {
  const value = row[column];
  return value === null || value === undefined ? null : asString(row, column);
};

/** `NUMERIC` chega como string e é assim que ela segue: nunca vira `number`. */
export const asNumeric = asString;
export const asNumericOrNull = asStringOrNull;

export const asInteger = (row: Row, column: string): number => {
  const value = row[column];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return missing(column, value);
};

export const asIntegerOrNull = (row: Row, column: string): number | null => {
  const value = row[column];
  return value === null || value === undefined ? null : asInteger(row, column);
};

export const asBoolean = (row: Row, column: string): boolean => row[column] === true;

export const asIsoString = (row: Row, column: string): string => {
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return missing(column, value);
};

export const asIsoStringOrNull = (row: Row, column: string): string | null => {
  const value = row[column];
  return value === null || value === undefined ? null : asIsoString(row, column);
};

export const asDateOnly = (row: Row, column: string): DateOnly => {
  const value = row[column];
  if (value instanceof Date || typeof value === 'string') return toDateOnly(value);
  return missing(column, value);
};

export const asDateOnlyOrNull = (row: Row, column: string): DateOnly | null => {
  const value = row[column];
  return value === null || value === undefined ? null : asDateOnly(row, column);
};

/** `jsonb` volta do driver já desserializado; o que chega como texto é lido. */
export const asJsonOrNull = (
  row: Row,
  column: string,
): Record<string, unknown> | null => {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>;
  if (typeof value === 'object') return value as Record<string, unknown>;
  return missing(column, value);
};

/**
 * Um valor de tipo enumerado do Postgres. O domínio fechado é do banco; aqui a
 * conferência existe para o compilador, e falhar é melhor do que deixar passar
 * um valor que nenhum `switch` trata.
 */
export const asEnum = <T extends string>(
  row: Row,
  column: string,
  values: readonly T[],
): T => {
  const value = row[column];
  if (typeof value === 'string' && (values as readonly string[]).includes(value)) {
    return value as T;
  }
  return missing(column, value);
};

export const asEnumOrNull = <T extends string>(
  row: Row,
  column: string,
  values: readonly T[],
): T | null => {
  const value = row[column];
  return value === null || value === undefined ? null : asEnum(row, column, values);
};

export { isDateOnly };
