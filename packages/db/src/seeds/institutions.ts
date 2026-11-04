export type InstitutionSource = 'str' | 'cvm';

const strip = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const squash = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const parseCsv = (text: string): readonly (readonly string[])[] => {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];

    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[index + 1] === '\n') index += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);

  return rows;
};

const headerIndex = (
  rows: readonly (readonly string[])[],
  wanted: (header: string) => boolean,
): number => rows.findIndex((row) => row.some((cell) => wanted(strip(cell))));

const columnOf = (
  header: readonly string[],
  ...tests: readonly ((name: string) => boolean)[]
): number => {
  for (const test of tests) {
    const found = header.findIndex((cell) => test(strip(cell)));
    if (found >= 0) return found;
  }
  return -1;
};

/**
 * Participantes do STR, do Banco Central. O arquivo tem uma linha de título
 * antes do cabeçalho em algumas edições, então o cabeçalho é procurado.
 */
export const parseStrParticipants = (text: string): readonly string[] => {
  const rows = parseCsv(text);
  const start = headerIndex(rows, (name) => name.includes('nome'));
  const header = rows[start];
  if (header === undefined) return [];

  const column = columnOf(
    header,
    (name) => name.includes('nome') && name.includes('reduz'),
    (name) => name.includes('nome'),
  );
  if (column < 0) return [];

  return rows
    .slice(start + 1)
    .map((row) => squash(row[column] ?? ''))
    .filter((name) => name.length > 1);
};

/**
 * Intermediários da CVM. Fica o nome comercial, ou a razão social quando não há,
 * e só quem está em funcionamento normal quando o arquivo traz a situação.
 */
export const parseCvmIntermediaries = (text: string): readonly string[] => {
  const rows = parseCsv(text);
  const start = headerIndex(rows, (name) => name.startsWith('denom_'));
  const header = rows[start];
  if (header === undefined) return [];

  const trade = columnOf(header, (name) => name === 'denom_comerc');
  const legal = columnOf(header, (name) => name === 'denom_social');
  const status = columnOf(header, (name) => name === 'sit');

  return rows
    .slice(start + 1)
    .filter(
      (row) =>
        status < 0 || strip(row[status] ?? '').includes('funcionamento normal'),
    )
    .map((row) => squash(row[trade] ?? '') || squash(row[legal] ?? ''))
    .filter((name) => name.length > 1);
};

/** Junta as listas sem repetir: mesmo nome, ignorando caixa e acento, entra uma vez. */
export const mergeInstitutionNames = (
  ...lists: readonly (readonly string[])[]
): readonly string[] => {
  const seen = new Map<string, string>();

  for (const name of lists.flat()) {
    const key = strip(name);
    if (!seen.has(key)) seen.set(key, name);
  }

  return [...seen.values()].sort((left, right) => left.localeCompare(right, 'pt-BR'));
};
