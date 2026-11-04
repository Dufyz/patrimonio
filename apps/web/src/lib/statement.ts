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

/** O extrato traz o período inteiro de uma vez; o teto só protege de um pedido sem fim. */
export const STATEMENT_LIMIT = 2000;

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
  event: 'eventos',
  custody: 'custodia',
};

export const GROUP_LABELS: Readonly<Record<StatementGroup, string>> = {
  buy: 'Compras',
  sell: 'Vendas',
  payout: 'Proventos',
  event: 'Eventos',
  custody: 'Custódia',
};

export const groupToParam = (group: StatementGroup): string => GROUP_PARAMS[group];

export const groupFromParam = (raw: string | null): StatementGroup | null => {
  const found = (Object.entries(GROUP_PARAMS) as [StatementGroup, string][]).find(
    ([, value]) => value === raw,
  );
  return found?.[0] ?? null;
};

/** `vendas,proventos` → os tipos que o endereço pede, sem repetir nem inventar. */
export const groupsFromParam = (raw: string | null): readonly StatementGroup[] => [
  ...new Set(
    (raw ?? '')
      .split(',')
      .map((part) => groupFromParam(part))
      .filter((group): group is StatementGroup => group !== null),
  ),
];

/** O padrão — nenhum tipo escolhido — nunca é escrito na URL. */
export const groupsToParam = (groups: readonly StatementGroup[]): string | null =>
  groups.length === 0 ? null : groups.map((group) => GROUP_PARAMS[group]).join(',');

/** `id1,id2` do endereço → lista; vazio vira lista vazia. */
export const listFromParam = (raw: string | null): readonly string[] =>
  (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

export const listToParam = (ids: readonly string[]): string | null =>
  ids.length === 0 ? null : ids.join(',');

export const periodFromParam = (raw: string | null): Period =>
  raw === null ? DEFAULT_STATEMENT_PERIOD : decodePeriod(raw);

/** O padrão nunca é escrito na URL. */
export const periodToParam = (period: Period): string | null =>
  encodePeriod(period) === encodePeriod(DEFAULT_STATEMENT_PERIOD)
    ? null
    : encodePeriod(period);

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

/** A troca de custodiante é fato do livro, mas não um lançamento: não se edita nem se exclui aqui. */
export const isLedgerEntry = (row: StatementRow): boolean =>
  row.kind !== 'custody_transfer';

export const typeLabel = (row: StatementRow): string =>
  row.kind === 'custody_transfer' ? 'Custódia' : TRANSACTION_KIND_LABELS[row.kind];

/** O "rendimento" ao lado de "Provento": o subtipo, em cinza. */
export const typeDetail = (row: StatementRow): string | null =>
  row.kind === 'payout' && row.payout_kind !== null
    ? (PAYOUT_KIND_LABELS[row.payout_kind]?.toLowerCase() ?? null)
    : null;

export const assetLabel = (row: StatementRow): string =>
  row.ticker ?? row.asset_name ?? '—';

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
 * As linhas do resumo. Compras (aportes), vendas (resgates) e proventos aparecem
 * sempre — "vendas R$ 0,00" é uma resposta.
 */
export const summaryItems = (summary: StatementSummary): readonly SummaryItem[] => [
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
 * tipo já diz a direção —, e o provento leva sinal, como na prancha. É remoção de caractere, não aritmética.
 */
export const valueCell = (
  row: StatementRow,
): { readonly value: string; readonly signed: boolean } =>
  row.kind === 'payout'
    ? { value: row.net_amount, signed: true }
    : { value: unsigned(row.net_amount), signed: false };

/** Sem quantidade, preço ou taxa — evento — a célula é traço. */
export const hasMarketColumns = (row: StatementRow): boolean =>
  row.kind !== 'corporate_event' && row.kind !== 'custody_transfer';

/* -------------------------------------------------------------------------- */
/* Efeito                                                                     */

export type EffectView = {
  readonly text: string;
  readonly tone: 'neutral' | 'positive' | 'negative' | 'attention';
};

const money = (value: string, hidden: boolean): string =>
  formatMoney(value, { hidden }).text;

const change = (value: string, hidden: boolean): string =>
  formatMoneyChange(value, { hidden }).text;

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
        text: `PM ${money(effect.avg_price, hidden)}`,
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
    case 'corporate_event':
      return {
        text: `${ratio(effect.ratio_from)}:${ratio(effect.ratio_to)} · ${ratio(
          effect.quantity_before,
        )} → ${ratio(effect.quantity_after)}`,
        tone: 'neutral',
      };
    case 'custody_transfer':
      return {
        text: `${effect.from_institution ?? '—'} → ${effect.to_institution ?? '—'}`,
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
  const selectable = rows.filter(isLedgerEntry);
  const count = selectable.filter((row) => selected.has(row.id)).length;
  if (count === 0) return 'none';
  return count === selectable.length ? 'all' : 'some';
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
    : new Set(rows.filter(isLedgerEntry).map((row) => row.id));

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
      const label = (
        kind === 'custody_transfer'
          ? 'Custódia'
          : TRANSACTION_KIND_LABELS[kind as keyof typeof TRANSACTION_KIND_LABELS]
      ).toLowerCase();
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
export const safeText = (value: string): string =>
  /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;

export const quoted = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/** Decimal com vírgula, que é o que a planilha em português entende. */
export const decimalComma = (value: string): string => value.replace('.', ',');

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
