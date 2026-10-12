import type { DateOnly } from '@patrimonio/domain';

import type { ImportKind, ImportRow } from './import_csv.js';

/**
 * Lê o arquivo que "Exportar tudo → JSON" gera (`patrimonio-export-v1`) e o
 * devolve como as mesmas linhas da importação de CSV: o livro vira lançamentos,
 * e a gravação é a de sempre. Só o livro volta — cadastros derivados (posições,
 * patrimônio) se refazem a partir dele.
 *
 * Os identificadores do arquivo não valem numa instalação nova: ativo, carteira
 * e instituição são reencontrados pelo código e pelo nome.
 *
 * Valores numéricos são lidos do texto original quando o navegador permite
 * (`context.source`), para `numeric(20,8)` não passar por `double`.
 */
type Reviver = (key: string, value: unknown, context?: { source?: string }) => unknown;

const exact: Reviver = (_key, value, context) =>
  typeof value === 'number' && context?.source !== undefined ? context.source : value;

type Table = readonly Record<string, unknown>[];

const text = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;

const date = (value: unknown): DateOnly | undefined => {
  const raw = text(value);
  return raw !== null && /^\d{4}-\d{2}-\d{2}/.test(raw)
    ? (raw.slice(0, 10) as DateOnly)
    : undefined;
};

const decimal = (value: unknown): string | null => {
  const raw = text(value);
  return raw !== null && /^-?\d+(\.\d+)?$/.test(raw) ? raw : null;
};

const KINDS: readonly string[] = ['buy', 'sell', 'payout'];

export type ExportRead =
  | { readonly ok: true; readonly rows: readonly ImportRow[]; readonly skipped: number }
  | { readonly ok: false; readonly message: string };

export const looksLikeExport = (content: string): boolean =>
  content.trimStart().startsWith('{');

export const readExport = (content: string): ExportRead => {
  let parsed: { format?: unknown; tables?: Record<string, Table> };

  try {
    parsed = JSON.parse(content, exact as never) as typeof parsed;
  } catch {
    return { ok: false, message: 'O arquivo não é um JSON válido.' };
  }

  if (parsed.format !== 'patrimonio-export-v1' || parsed.tables === undefined) {
    return { ok: false, message: 'Este JSON não é uma exportação do Patrimônio.' };
  }

  const tables = parsed.tables;
  const nameById = (table: string): Map<string, string> =>
    new Map(
      (tables[table] ?? []).flatMap((row) => {
        const id = text(row['id']);
        const name = text(row['name']);
        return id === null || name === null ? [] : [[id, name] as const];
      }),
    );

  const portfolios = nameById('portfolio');
  const institutions = nameById('institution');
  const assets = new Map(
    (tables['asset'] ?? []).flatMap((row) => {
      const id = text(row['id']);
      return id === null ? [] : [[id, row] as const];
    }),
  );

  let skipped = 0;
  const rows: ImportRow[] = [];

  for (const [index, entry] of (tables['transaction'] ?? []).entries()) {
    const kind = text(entry['kind']);
    if (kind === null || !KINDS.includes(kind)) {
      skipped += 1;
      continue;
    }

    const asset = assets.get(text(entry['asset_id']) ?? '');
    const trade_date = date(entry['trade_date']) ?? null;
    const quantity = decimal(entry['quantity']);
    const unit_price = decimal(entry['unit_price']);
    const fees = decimal(entry['fees']) ?? '0';
    const ticker = text(asset?.['ticker'])?.toUpperCase() ?? null;

    const errors = [
      trade_date === null ? 'data inválida' : null,
      ticker === null ? 'ativo ausente' : null,
      quantity === null || unit_price === null ? 'valores inválidos' : null,
    ].filter((error): error is string => error !== null);

    const payout = text(entry['payout_kind']);

    rows.push({
      line: index + 1,
      trade_date,
      kind: kind as ImportKind,
      ticker,
      quantity,
      unit_price,
      fees,
      errors,
      settlement_date: date(entry['settlement_date']),
      tax_withheld: decimal(entry['tax_withheld']) ?? undefined,
      payout_kind: (payout ?? undefined) as ImportRow['payout_kind'],
      record_date: date(entry['record_date']),
      note: text(entry['note']) ?? undefined,
      asset_name: text(asset?.['name']) ?? undefined,
      b3_type: text(asset?.['b3_type']),
      portfolio_name: portfolios.get(text(entry['portfolio_id']) ?? '') ?? null,
      institution_name: institutions.get(text(entry['institution_id']) ?? '') ?? null,
    });
  }

  return { ok: true, rows, skipped };
};
