/**
 * Exportação das tabelas em CSV: separador `;` e vírgula decimal, que é o que a
 * planilha em português espera. Campos com `;`, aspas ou quebra vão entre aspas.
 */

const field = (value: string): string =>
  /[;"\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export const toCsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.map(field).join(';')).join('\r\n');

export const downloadCsv = (
  filename: string,
  rows: readonly (readonly string[])[],
): void => {
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
