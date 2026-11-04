import { compareDates, isDateInRange } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { sum } from '../lib/money.js';
import type { Cents } from '../lib/money.js';
import type { DateRange } from '../lib/period.js';
import { isPosted } from './ledger.js';
import type { Entry } from './types.js';

/**
 * Os grupos da tabela de Lançamentos. Hoje só "por dia" (FIN-302); os outros
 * agrupamentos entram com a FIN-304 sobre a mesma forma de grupo.
 */

/** O resumo à direita do cabeçalho: só o que existe no grupo aparece. */
export type GroupSummary = {
  readonly receitas?: Cents;
  readonly despesas?: Cents;
  readonly previsto?: Cents;
};

export type LedgerGroup = {
  readonly id: string;
  readonly kind: 'previstos' | 'dia';
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
