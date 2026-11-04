import { compareDates, isDateInRange } from '../lib/dates.js';
import { passesFilters } from '../lib/filters.js';
import type { FilterState } from '../lib/filters.js';
import { sum } from '../lib/money.js';
import type { Cents } from '../lib/money.js';
import type { DateRange } from '../lib/period.js';
import { matchesSearch } from '../lib/text.js';
import { sourceName } from './sources.js';
import type { Entry, FinanceData } from './types.js';

/**
 * Lançamentos: a leitura do livro (FIN-301 a FIN-311).
 *
 * Funções puras sobre `FinanceData`. O histórico (`historical`) nunca aparece
 * aqui — ele só alimenta as médias por categoria. Só o lançado conta em totais
 * (RN-02); o previsto aparece à parte.
 */

export const isPosted = (entry: Entry): boolean => entry.status === 'lancada';

/** Os nomes das origens, na ordem em que foram informadas. */
export const accountNames = (entry: Entry): readonly string[] =>
  entry.payments.map((payment) => sourceName(payment.sourceId));

/** RN-23: a origem principal é a de maior parte; no empate, a primeira informada. */
export const primarySourceId = (entry: Entry): string | undefined => {
  let best: Entry['payments'][number] | undefined;
  for (const payment of entry.payments) {
    if (best === undefined || payment.cents > best.cents) best = payment;
  }
  return best?.sourceId;
};

/** Busca e filtros da tela: tipo, categoria, conta (qualquer origem) e situação. */
export const queryEntries = (
  data: FinanceData,
  search: string,
  filters: FilterState,
): readonly Entry[] =>
  data.entries.filter((entry) => {
    if (entry.historical === true) return false;
    const category = data.categories.find((c) => c.id === entry.categoryId)?.name ?? '';
    if (!matchesSearch(search, [entry.description, category, ...accountNames(entry)])) {
      return false;
    }
    return passesFilters(filters, (field) => {
      switch (field) {
        case 'tipo':
          return entry.kind;
        case 'categoria':
          return entry.categoryId;
        case 'conta':
          return entry.payments.map((payment) => payment.sourceId);
        default:
          return entry.status;
      }
    });
  });

export type Tally = { readonly cents: Cents; readonly count: number };

const tally = (entries: readonly Entry[]): Tally => ({
  cents: sum(entries.map((entry) => entry.cents)),
  count: entries.length,
});

export type Indicators = {
  readonly receitas: Tally;
  readonly despesas: Tally;
  /** Receitas − despesas lançadas, com sinal. */
  readonly saldo: Cents;
  /** Soma dos previstos até o fim do período (RN-13: vencidos continuam somando). */
  readonly aLancar: Tally;
};

/** FIN-301: os números da faixa, a partir das linhas que a tabela está mostrando. */
export const indicators = (entries: readonly Entry[], range: DateRange): Indicators => {
  const posted = entries.filter(
    (entry) => isPosted(entry) && isDateInRange(entry.date, range),
  );
  const receitas = tally(posted.filter((entry) => entry.kind === 'receita'));
  const despesas = tally(posted.filter((entry) => entry.kind === 'despesa'));
  const pending = entries.filter(
    (entry) => !isPosted(entry) && compareDates(entry.date, range.to) <= 0,
  );
  return {
    receitas,
    despesas,
    saldo: receitas.cents - despesas.cents,
    aLancar: tally(pending),
  };
};
