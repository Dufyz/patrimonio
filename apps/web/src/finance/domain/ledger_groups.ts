import { compareDates, isDateInRange } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { sum } from '../lib/money.js';
import type { Cents } from '../lib/money.js';
import type { DateRange } from '../lib/period.js';
import type { EntryGrouping } from '../lib/preferences.js';
import { isPosted, primarySourceId } from './ledger.js';
import { SOURCES, sourceName } from './sources.js';
import type { Category, Entry } from './types.js';

/**
 * Os grupos da tabela de Lançamentos: por dia (FIN-302) e por tipo, categoria e
 * conta (FIN-304). Todos usam a mesma forma de grupo, e a faixa de indicadores,
 * a busca e os filtros não dependem do agrupamento escolhido.
 */

/** O resumo à direita do cabeçalho: só o que existe no grupo aparece. */
export type GroupSummary = {
  readonly receitas?: Cents;
  readonly despesas?: Cents;
  readonly previsto?: Cents;
};

export type LedgerGroup = {
  readonly id: string;
  readonly kind: 'previstos' | EntryGrouping;
  /** Nome do grupo, nos agrupamentos por tipo, categoria e conta. */
  readonly title?: string;
  /** Só em grupos por dia. */
  readonly date?: IsoDate;
  readonly entries: readonly Entry[];
  readonly summary: GroupSummary;
};

const totalOf = (entries: readonly Entry[], kind: Entry['kind']): Cents =>
  sum(entries.filter((entry) => entry.kind === kind).map((entry) => entry.cents));

/** Resumo de lançados: receitas e despesas, só as que existem. */
export const summarize = (entries: readonly Entry[]): GroupSummary => {
  const posted = entries.filter(isPosted);
  const pending = entries.filter((entry) => !isPosted(entry));
  return {
    ...(posted.some((e) => e.kind === 'receita')
      ? { receitas: totalOf(posted, 'receita') }
      : {}),
    ...(posted.some((e) => e.kind === 'despesa')
      ? { despesas: totalOf(posted, 'despesa') }
      : {}),
    ...(pending.length > 0 ? { previsto: sum(pending.map((e) => e.cents)) } : {}),
  };
};

/** Mais novo primeiro; no mesmo dia, a ordem em que foram registrados. */
const newestFirst = (entries: readonly Entry[]): readonly Entry[] =>
  entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => compareDates(b.entry.date, a.entry.date) || a.index - b.index)
    .map(({ entry }) => entry);

/**
 * Por dia: primeiro "Próximos dias · previstos", do mais próximo ao mais
 * distante, e depois um grupo por dia com lançados, do mais novo ao mais antigo.
 * Previstos aparecem todos, seja qual for o período (decisão assumida do
 * documento); lançados, só os do período.
 */
export const groupByDay = (
  entries: readonly Entry[],
  range: DateRange,
): readonly LedgerGroup[] => {
  const pending = entries
    .filter((entry) => !isPosted(entry))
    .toSorted((a, b) => compareDates(a.date, b.date));

  const days = new Map<IsoDate, Entry[]>();
  for (const entry of newestFirst(
    entries.filter((e) => isPosted(e) && isDateInRange(e.date, range)),
  )) {
    days.set(entry.date, [...(days.get(entry.date) ?? []), entry]);
  }

  return [
    ...(pending.length === 0
      ? []
      : [
          {
            id: 'previstos',
            kind: 'previstos' as const,
            entries: pending,
            summary: summarize(pending),
          },
        ]),
    ...[...days].map(([date, list]) => ({
      id: `dia-${date}`,
      kind: 'dia' as const,
      date,
      entries: list,
      summary: summarize(list),
    })),
  ];
};

/** O que a tela mostra: todos os previstos e os lançados do período. */
const inScope = (entries: readonly Entry[], range: DateRange): readonly Entry[] =>
  entries.filter((entry) => !isPosted(entry) || isDateInRange(entry.date, range));

/** Dentro de cada grupo: previstos primeiro, e lançados do mais novo ao mais antigo. */
const ordered = (entries: readonly Entry[]): readonly Entry[] => [
  ...entries
    .filter((entry) => !isPosted(entry))
    .toSorted((a, b) => compareDates(a.date, b.date)),
  ...newestFirst(entries.filter(isPosted)),
];

const named = (
  grouping: 'tipo' | 'categoria' | 'conta',
  key: string,
  title: string,
  entries: readonly Entry[],
): LedgerGroup => {
  const list = ordered(entries);
  return {
    id: `${grouping}-${key}`,
    kind: grouping,
    title,
    entries: list,
    summary: summarize(list),
  };
};

/** Despesas antes das receitas, na ordem do cadastro de categorias. */
const byCategory = (
  entries: readonly Entry[],
  categories: readonly Category[],
): readonly LedgerGroup[] =>
  [
    ...categories.filter((c) => c.kind === 'despesa'),
    ...categories.filter((c) => c.kind === 'receita'),
  ]
    .map((category) => ({
      category,
      list: entries.filter((entry) => entry.categoryId === category.id),
    }))
    .filter(({ list }) => list.length > 0)
    .map(({ category, list }) => named('categoria', category.id, category.name, list));

/**
 * Por conta: a despesa fica no grupo da origem principal, com o valor total
 * (RN-23), e compra no cartão fica na seção do cartão — a origem dela é o cartão.
 */
const byAccount = (entries: readonly Entry[]): readonly LedgerGroup[] => {
  const ids = [
    ...SOURCES.map((source) => source.id),
    ...entries
      .map(primarySourceId)
      .filter(
        (id): id is string => id !== undefined && !SOURCES.some((s) => s.id === id),
      ),
  ];
  return [...new Set(ids)]
    .map((id) => ({ id, list: entries.filter((entry) => primarySourceId(entry) === id) }))
    .filter(({ list }) => list.length > 0)
    .map(({ id, list }) => named('conta', id, sourceName(id), list));
};

export const groupEntries = (
  grouping: EntryGrouping,
  entries: readonly Entry[],
  range: DateRange,
  categories: readonly Category[],
): readonly LedgerGroup[] => {
  const scoped = inScope(entries, range);
  switch (grouping) {
    case 'dia':
      return groupByDay(entries, range);
    case 'tipo':
      return (['receita', 'despesa'] as const)
        .map((kind) => ({ kind, list: scoped.filter((entry) => entry.kind === kind) }))
        .filter(({ list }) => list.length > 0)
        .map(({ kind, list }) =>
          named('tipo', kind, kind === 'receita' ? 'Receitas' : 'Despesas', list),
        );
    case 'categoria':
      return byCategory(scoped, categories);
    case 'conta':
      return byAccount(scoped);
  }
};
