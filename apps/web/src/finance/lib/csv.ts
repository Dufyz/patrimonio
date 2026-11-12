/**
 * Exportação das tabelas em CSV (FIN-310): separador vírgula, números sem
 * formatação de moeda e com ponto decimal, datas em ISO. Campos com vírgula,
 * aspas ou quebra de linha vão entre aspas.
 */

const field = (value: string): string =>
  /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export const toCsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.map(field).join(',')).join('\r\n');

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
