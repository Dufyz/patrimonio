import type {
  StatementEffect,
  StatementGroup,
  StatementMonth,
  StatementRow,
  StatementSummary,
} from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';

import { MONTH_NAMES } from './calendar.js';
import { compareDecimal } from './decimal.js';
import { formatMoney, formatMoneyChange } from './format.js';
import { PAYOUT_KIND_LABELS, TRANSACTION_KIND_LABELS } from './asset_page.js';
import type { Period } from './period.js';
import { decodePeriod, encodePeriod } from './period.js';

/**
 * T-04 · O que Movimentações decide por conta própria.
 *
 * O extrato é onde se corrige o passado, e quase tudo que ele mostra já chega
 * pronto da `api`: resumo, subtotal de mês, contagem por tipo, e a coluna
 * Efeito. Sobra a tradução — qual frase descreve cada efeito, como a URL
 * guarda o recorte, o que vai para o CSV. Nenhuma função aqui soma dinheiro.
 */

/** Quantos lançamentos cabem numa página. */
export const STATEMENT_PAGE_SIZE = 50;

/** Releitura enquanto o recálculo não termina, em milissegundos. */
export const RECALCULATION_POLL_MS = 4000;

/** Sem filtro de período, o extrato abre nos últimos três meses. */
export const DEFAULT_STATEMENT_PERIOD: Period = { kind: 'preset', preset: '3m' };

/* -------------------------------------------------------------------------- */
/* URL                                                                        */

/** Os valores na URL são em português, como o resto: `?grupo=proventos`. */
const GROUP_PARAMS: Readonly<Record<StatementGroup, string>> = {
  buy: 'compras',
  sell: 'vendas',
  payout: 'proventos',
  cash: 'caixa',
  event: 'eventos',
};

export const GROUP_LABELS: Readonly<Record<StatementGroup, string>> = {
  buy: 'Compras',
  sell: 'Vendas',
  payout: 'Proventos',
  cash: 'Aportes e resgates',
  event: 'Eventos',
};

export const groupToParam = (group: StatementGroup): string => GROUP_PARAMS[group];

export const groupFromParam = (raw: string | null): StatementGroup | null => {
  const found = (Object.entries(GROUP_PARAMS) as [StatementGroup, string][]).find(
    ([, value]) => value === raw,
  );
  return found?.[0] ?? null;
};

export const periodFromParam = (raw: string | null): Period =>
  raw === null ? DEFAULT_STATEMENT_PERIOD : decodePeriod(raw);

/** O padrão nunca é escrito na URL. */
export const periodToParam = (period: Period): string | null =>
  encodePeriod(period) === encodePeriod(DEFAULT_STATEMENT_PERIOD)
    ? null
    : encodePeriod(period);

export const pageFromParam = (raw: string | null): number => {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
};

/* -------------------------------------------------------------------------- */
/* Rótulos                                                                    */

/** `2026-10` → `Outubro 2026`, como o cabeçalho de mês da prancha 07. */
export const monthTitle = (month: string): string => {
  const [year = '', number = '1'] = month.split('-');
  const name = MONTH_NAMES[Number(number) - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
};

/** `2026-08` → `agosto`, para "Ampliar o período para agosto". */
export const monthName = (month: string): string =>
  MONTH_NAMES[Number(month.split('-')[1]) - 1] ?? '';

/** `2021-03-05` → `mar/2021`. */
export const sinceLabel = (date: DateOnly): string => {
  const [year = '', month = '1'] = date.split('-');
  return `${(MONTH_NAMES[Number(month) - 1] ?? '').slice(0, 3)}/${year}`;
};

export const entriesLabel = (count: number): string =>
  `${count} ${count === 1 ? 'lançamento' : 'lançamentos'}`;

export const typeLabel = (row: StatementRow): string => TRANSACTION_KIND_LABELS[row.kind];

/** O "rendimento" ao lado de "Provento": o subtipo, em cinza. */
export const typeDetail = (row: StatementRow): string | null =>
  row.kind === 'payout' && row.payout_kind !== null
    ? (PAYOUT_KIND_LABELS[row.payout_kind]?.toLowerCase() ?? null)
    : null;

/** Aporte e resgate não têm ativo: o que eles movem é o caixa da instituição. */
export const assetLabel = (row: StatementRow): string => {
  if (row.ticker !== null) return row.ticker;
  if (row.asset_name !== null) return row.asset_name;
  return `Caixa · ${row.institution_name ?? 'sem instituição'}`;
};

export const rowLabel = (row: StatementRow): string =>
  `${typeLabel(row)} de ${assetLabel(row)} em ${row.trade_date}`;

/* -------------------------------------------------------------------------- */
/* Resumo                                                                     */

export type SummaryItem = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
};

const isNonZero = (value: string): boolean => compareDecimal(value, '0') !== 0;

/**
 * As linhas do resumo. Aportes, compras, vendas e proventos aparecem sempre —
 * "vendas R$ 0,00" é uma resposta —, resgates só quando houve, porque a maioria
 * dos recortes não tem e a quinta coluna fixa seria ruído.
 */
export const summaryItems = (summary: StatementSummary): readonly SummaryItem[] => [
  { key: 'deposits', label: 'aportes', value: summary.deposits },
  ...(isNonZero(summary.withdrawals)
    ? [{ key: 'withdrawals', label: 'resgates', value: summary.withdrawals }]
    : []),
  { key: 'buys', label: 'compras', value: summary.buys },
  { key: 'sells', label: 'vendas', value: summary.sells },
  { key: 'payouts', label: 'proventos', value: summary.payouts },
];

/** O subtotal do mês só cita o que aconteceu nele. */
export const monthItems = (month: StatementMonth): readonly SummaryItem[] =>
  summaryItems(month).filter((item) => isNonZero(item.value));

/* -------------------------------------------------------------------------- */
/* Valor                                                                      */

const unsigned = (value: string): string =>
  value.startsWith('-') ? value.slice(1) : value;

/**
 * O que a coluna Valor mostra. Compra e venda aparecem em módulo, sem sinal — o
 * tipo já diz a direção —, e dinheiro que entra ou sai do caixa leva sinal,
 * como na prancha. É remoção de caractere, não aritmética.
 */
export const valueCell = (
  row: StatementRow,
): { readonly value: string; readonly signed: boolean } =>
  row.kind === 'payout' || row.kind === 'deposit' || row.kind === 'withdrawal'
    ? { value: row.net_amount, signed: true }
    : { value: unsigned(row.net_amount), signed: false };

/** Sem quantidade, preço ou taxa — aporte, resgate — a célula é traço. */
export const hasMarketColumns = (row: StatementRow): boolean =>
  row.kind !== 'deposit' && row.kind !== 'withdrawal' && row.kind !== 'corporate_event';

/* -------------------------------------------------------------------------- */
/* Efeito                                                                     */

export type EffectView = {
  readonly text: string;
  readonly tone: 'neutral' | 'positive' | 'negative' | 'attention';
};

const money = (value: string, hidden: boolean): string =>
  formatMoney(value, { bare: true, hidden }).text;

const change = (value: string, hidden: boolean): string =>
  formatMoneyChange(value, { bare: true, hidden }).text;

const ratio = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;

/**
 * A frase da coluna Efeito. É o que o lançamento mudou, em palavras que quem
 * confere a nota da corretora reconhece: "PM 38,20 → 36,80", "−310,00
 * realizado", "isento de IR". `hidden` é o modo de valores ocultos: o preço
 * médio e o resultado são dinheiro, e a coluna não pode ser a brecha.
 */
export const effectView = (effect: StatementEffect, hidden = false): EffectView => {
  switch (effect.type) {
    case 'average_price':
      return {
        text: `PM ${money(effect.before, hidden)} → ${money(effect.after, hidden)}`,
        tone: 'neutral',
      };
    case 'position_opened':
      return {
        text: `abre posição · PM ${money(effect.avg_price, hidden)}`,
        tone: 'neutral',
      };
    case 'realized': {
      const sign = effect.result.startsWith('-') ? 'negative' : 'positive';
      const exempt = effect.exempt === true ? ' · isento' : '';
      return { text: `${change(effect.result, hidden)} realizado${exempt}`, tone: sign };
    }
    case 'payout_exempt':
      return { text: 'isento de IR', tone: 'neutral' };
    case 'payout_withheld':
      return { text: `IR retido ${money(effect.tax, hidden)}`, tone: 'neutral' };
    case 'payout_receivable':
      return {
        text:
          effect.expected === null
            ? 'a receber'
            : `a receber · previsto ${money(effect.expected, hidden)}`,
        tone: 'attention',
      };
    case 'cost_reduction':
      return {
        text: `reduz o custo em ${money(effect.amount, hidden)}`,
        tone: 'neutral',
      };
    case 'cash_in':
      return { text: 'vindo de fora do app', tone: 'neutral' };
    case 'cash_out':
      return { text: 'saindo do app', tone: 'neutral' };
    case 'corporate_event':
      return {
        text: `${ratio(effect.ratio_from)}:${ratio(effect.ratio_to)} · ${ratio(
          effect.quantity_before,
        )} → ${ratio(effect.quantity_after)}`,
        tone: 'neutral',
      };
    case 'none':
      return { text: '—', tone: 'neutral' };
  }
};

/* -------------------------------------------------------------------------- */
/* Seleção                                                                    */

export type SelectionState = 'none' | 'some' | 'all';

export const selectionState = (
  rows: readonly StatementRow[],
  selected: ReadonlySet<string>,
): SelectionState => {
  const count = rows.filter((row) => selected.has(row.id)).length;
  if (count === 0) return 'none';
  return count === rows.length ? 'all' : 'some';
};

export const toggleSelected = (
  selected: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> => {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** O cabeçalho marca tudo, ou — se já está tudo marcado — desmarca tudo. */
export const toggleAll = (
  rows: readonly StatementRow[],
  selected: ReadonlySet<string>,
): ReadonlySet<string> =>
  selectionState(rows, selected) === 'all'
    ? new Set<string>()
    : new Set(rows.map((row) => row.id));

/** Mantém só o que ainda está na página: página nova não herda seleção velha. */
export const pruneSelection = (
  rows: readonly StatementRow[],
  selected: ReadonlySet<string>,
): ReadonlySet<string> => {
  const present = new Set(rows.map((row) => row.id));
  const kept = [...selected].filter((id) => present.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
};

/** "2 compras", "1 compra · 1 venda": o que a seleção contém, sem somar. */
export const selectionKinds = (rows: readonly StatementRow[]): string => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);

  return [...counts.entries()]
    .map(([kind, count]) => {
      const label = TRANSACTION_KIND_LABELS[kind as StatementRow['kind']].toLowerCase();
      return `${count} ${count === 1 ? label : pluralKind(label)}`;
    })
    .join(' · ');
};

const pluralKind = (label: string): string =>
  label.endsWith('ão') ? `${label.slice(0, -2)}ões` : `${label}s`;

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */

const CSV_HEADER = [
  'Data',
  'Tipo',
  'Ativo',
  'Carteira',
  'Instituição',
  'Quantidade',
  'Preço',
  'Taxas',
  'Valor',
  'Efeito',
] as const;

/** Uma célula de texto que começa como fórmula vira texto, não fórmula. */
const safeText = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

const quoted = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/** Decimal com vírgula, que é o que a planilha em português entende. */
const decimalComma = (value: string): string => value.replace('.', ',');

/**
 * O CSV da seleção: `;` e vírgula decimal, porque é assim que a planilha em
 * português o abre sem pedir nada. Valores saem como a `api` os mandou, sem
 * arredondar — o arquivo é para conferir, e conferir é com o número inteiro.
 */
export const statementCsv = (rows: readonly StatementRow[]): string => {
  const lines = rows.map((row) => {
    const market = hasMarketColumns(row);
    const cells = [
      row.trade_date,
      [typeLabel(row), typeDetail(row)].filter((part) => part !== null).join(' '),
      safeText(assetLabel(row)),
      safeText(row.portfolio_name),
      safeText(row.institution_name ?? ''),
      market ? decimalComma(row.quantity) : '',
      market ? decimalComma(row.unit_price) : '',
      market ? decimalComma(row.fees) : '',
      decimalComma(row.net_amount),
      effectView(row.effect).text,
    ];
    return cells.map(quoted).join(';');
  });

  return [CSV_HEADER.map(quoted).join(';'), ...lines].join('\r\n');
};

export const CSV_BOM = '﻿';

export const csvFilename = (today: DateOnly): string => `movimentacoes-${today}.csv`;
