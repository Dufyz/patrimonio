import { downloadCsv } from './csv.js';
import type { Cents } from './money.js';
import type { DateRange } from './period.js';

/**
 * FIN-310 · O exportar único de Finanças.
 *
 * Exporta exatamente as linhas que a tabela mostra e só as colunas visíveis, na
 * ordem atual. Valores saem como número com ponto decimal (`-312.40`), sem `R$`.
 * O arquivo leva o nome da tela e o período. Lançamentos, Recorrentes,
 * Categorias e a Fatura usam esta mesma função.
 */

export type ExportColumn<T> = {
  readonly id: string;
  readonly header: string;
  readonly value: (row: T) => string;
};

/** `-31240` → `-312.40`. Sem separador de milhar e sem símbolo. */
export const csvAmount = (cents: Cents): string => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

export const tableRows = <T>(
  columns: readonly ExportColumn<T>[],
  hidden: readonly string[],
  rows: readonly T[],
): readonly (readonly string[])[] => {
  const shown = columns.filter((column) => !hidden.includes(column.id));
  return [
    shown.map((c) => c.header),
    ...rows.map((row) => shown.map((c) => c.value(row))),
  ];
};

/** `lancamentos_2026-10-01_2026-10-31.csv`. */
export const exportFilename = (screen: string, period: DateRange): string =>
  `${screen}_${period.from}_${period.to}.csv`;

export const exportTable = <T>(
  screen: string,
  period: DateRange,
  columns: readonly ExportColumn<T>[],
  hidden: readonly string[],
  rows: readonly T[],
): void => downloadCsv(exportFilename(screen, period), tableRows(columns, hidden, rows));
