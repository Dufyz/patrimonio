import type { DateOnly } from '@patrimonio/domain';

import { parseAmountInput } from './positions.js';

/**
 * A importação de planilha: lê o CSV no navegador e entrega linhas validadas.
 * Nada aqui fala com a api nem soma dinheiro — o texto vira campo, e o campo
 * vira o corpo de um lançamento comum, que a api valida e grava como qualquer
 * outro.
 */

export type ImportField = 'date' | 'kind' | 'ticker' | 'quantity' | 'price' | 'fees';

export const IMPORT_FIELDS: readonly {
  readonly field: ImportField;
  readonly label: string;
  readonly required: boolean;
}[] = [
  { field: 'date', label: 'Data', required: true },
  { field: 'kind', label: 'Tipo (compra/venda)', required: true },
  { field: 'ticker', label: 'Ativo (código)', required: true },
  { field: 'quantity', label: 'Quantidade', required: true },
  { field: 'price', label: 'Preço unitário', required: true },
  { field: 'fees', label: 'Taxas', required: false },
];

/** O índice da coluna de cada campo; `null` é "não usar". */
export type ImportMapping = Readonly<Record<ImportField, number | null>>;

const normalize = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Divide o texto em linhas e células; aspas duplas protegem o separador. */
export const parseCsv = (text: string): string[][] => {
  const source = text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text;
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best,
  );

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] as string;

    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
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

const SYNONYMS: Readonly<Record<ImportField, readonly string[]>> = {
  date: ['data', 'data da operacao', 'data operacao', 'data negocio', 'date', 'dia'],
  kind: ['tipo', 'operacao', 'movimentacao', 'compra/venda', 'c/v', 'natureza', 'type'],
  ticker: [
    'ativo',
    'codigo',
    'ticker',
    'papel',
    'produto',
    'codigo de negociacao',
    'asset',
  ],
  quantity: ['quantidade', 'qtd', 'qtde', 'quant', 'quantity'],
  price: ['preco', 'preco unitario', 'preco medio', 'valor unitario', 'cotacao', 'price'],
  fees: ['taxas', 'taxa', 'custos', 'corretagem', 'emolumentos', 'fees'],
};

/** A melhor correspondência do cabeçalho com cada campo; o usuário corrige depois. */
export const guessMapping = (header: readonly string[]): ImportMapping => {
  const names = header.map(normalize);
  const used = new Set<number>();

  const find = (field: ImportField): number | null => {
    for (const synonym of SYNONYMS[field]) {
      const exact = names.findIndex(
        (name, index) => !used.has(index) && name === synonym,
      );
      if (exact >= 0) return exact;
    }
    for (const synonym of SYNONYMS[field]) {
      const partial = names.findIndex(
        (name, index) => !used.has(index) && name.includes(synonym),
      );
      if (partial >= 0) return partial;
    }
    return null;
  };

  const pick = (field: ImportField): number | null => {
    const found = find(field);
    if (found !== null) used.add(found);
    return found;
  };

  return {
    date: pick('date'),
    kind: pick('kind'),
    ticker: pick('ticker'),
    quantity: pick('quantity'),
    price: pick('price'),
    fees: pick('fees'),
  };
};

export const missingFields = (mapping: ImportMapping): readonly string[] =>
  IMPORT_FIELDS.filter((item) => item.required && mapping[item.field] === null).map(
    (item) => item.label,
  );

export const parseImportDate = (text: string): DateOnly | null => {
  const value = text.trim();
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

  const [year, month, day] = br
    ? [br[3], br[2], br[1]]
    : iso
      ? [iso[1], iso[2], iso[3]]
      : [undefined, undefined, undefined];

  if (year === undefined || month === undefined || day === undefined) return null;

  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const check = new Date(`${date}T00:00:00Z`);

  return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== date
    ? null
    : (date as DateOnly);
};

export const parseImportKind = (text: string): 'buy' | 'sell' | null => {
  const value = normalize(text);
  if (['c', 'compra', 'buy', 'credito', 'aquisicao'].includes(value)) return 'buy';
  if (['v', 'venda', 'sell', 'debito', 'alienacao'].includes(value)) return 'sell';
  return null;
};

/** `ITUB4F` (fracionário) e `itub4` viram `ITUB4`. */
export const parseImportTicker = (text: string): string | null => {
  const value = text.trim().toUpperCase().split(/\s+/)[0] ?? '';
  const base = /^[A-Z]{4}\d{1,2}F$/.test(value) ? value.slice(0, -1) : value;
  return /^[A-Z0-9][A-Z0-9._-]{1,19}$/.test(base) ? base : null;
};

export type ImportKind = 'buy' | 'sell' | 'payout';

export const IMPORT_KIND_LABEL: Readonly<Record<ImportKind, string>> = {
  buy: 'Compra',
  sell: 'Venda',
  payout: 'Provento',
};

export type ImportRow = {
  /** A linha no arquivo, contando o cabeçalho como 1. */
  readonly line: number;
  readonly trade_date: DateOnly | null;
  readonly kind: ImportKind | null;
  readonly ticker: string | null;
  readonly quantity: string | null;
  readonly unit_price: string | null;
  readonly fees: string | null;
  readonly errors: readonly string[];
  /** Só o arquivo de exportação (JSON) traz estes campos. */
  readonly settlement_date?: DateOnly | undefined;
  readonly tax_withheld?: string | undefined;
  readonly payout_kind?:
    'dividend' | 'jcp' | 'income' | 'interest' | 'amortization' | undefined;
  readonly record_date?: DateOnly | undefined;
  readonly note?: string | undefined;
  readonly asset_name?: string | undefined;
  readonly b3_type?: string | null | undefined;
  readonly portfolio_name?: string | null | undefined;
  readonly institution_name?: string | null | undefined;
};

const positive = (value: string | null): boolean => value !== null && Number(value) > 0;

export const buildImportRows = (
  table: readonly (readonly string[])[],
  mapping: ImportMapping,
): readonly ImportRow[] =>
  table.slice(1).map((cells, offset) => {
    const at = (field: ImportField): string => {
      const index = mapping[field];
      return index === null ? '' : (cells[index] ?? '');
    };

    const trade_date = parseImportDate(at('date'));
    const kind = parseImportKind(at('kind'));
    const ticker = parseImportTicker(at('ticker'));
    const quantity = parseAmountInput(at('quantity'));
    const unit_price = parseAmountInput(at('price'));
    const feesText = at('fees');
    const fees = feesText.trim() === '' ? '0' : parseAmountInput(feesText);

    const errors = [
      trade_date === null ? 'data inválida' : null,
      kind === null ? 'tipo desconhecido' : null,
      ticker === null ? 'ativo inválido' : null,
      positive(quantity) ? null : 'quantidade inválida',
      unit_price === null || Number(unit_price) < 0 ? 'preço inválido' : null,
      fees === null || Number(fees) < 0 ? 'taxas inválidas' : null,
    ].filter((error): error is string => error !== null);

    return {
      line: offset + 2,
      trade_date,
      kind,
      ticker,
      quantity,
      unit_price,
      fees: fees === null ? null : fees,
      errors,
    };
  });
