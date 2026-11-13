import type { RecurringGrouping } from '../finance/lib/preferences.js';
import { fromCents, toCents } from './projection_view.js';

/**
 * REC-01/02 · A conta da tela Recorrentes, sobre os recorrentes que o servidor
 * devolve. Valores em centavos inteiros (nada de ponto flutuante em dinheiro).
 * O percentual do bloco e o resultado mensal consideram só o que está ativo e
 * visível (RN-U10), e os percentuais, em décimos, somam exatamente 1000.
 */
export type RecurringKind = 'receita' | 'despesa' | 'aporte';

export type RecurringResource = {
  readonly id: string;
  readonly name: string;
  readonly kind: RecurringKind;
  readonly category_id: string | null;
  readonly portfolio_id?: string | null | undefined;
  readonly asset_id?: string | null | undefined;
  readonly source: { readonly type: 'conta' | 'cartao'; readonly id: string };
  readonly second_source: {
    readonly type: 'conta' | 'cartao';
    readonly id: string;
  } | null;
  readonly covers_up_to: string | null;
  readonly day: number;
  readonly mode: 'manual' | 'automatico';
  readonly amount: string;
  readonly active: boolean;
  readonly version: number;
};

export const KIND_LABEL: Readonly<Record<RecurringKind, string>> = {
  receita: 'Receitas',
  despesa: 'Despesas',
  aporte: 'Aportes',
};

export const KIND_ORDER: readonly RecurringKind[] = ['receita', 'despesa', 'aporte'];

export type RecurringFilters = {
  readonly q: string;
  readonly kinds: readonly RecurringKind[];
  readonly categories: readonly string[];
  readonly sources: readonly string[];
  readonly situation: readonly ('ativo' | 'pausado')[];
  readonly modes: readonly ('manual' | 'automatico')[];
};

export const EMPTY_RECURRING_FILTERS: RecurringFilters = {
  q: '',
  kinds: [],
  categories: [],
  sources: [],
  situation: [],
  modes: [],
};

export const hasRecurringFilters = (filters: RecurringFilters): boolean =>
  filters.q.trim() !== '' ||
  filters.kinds.length > 0 ||
  filters.categories.length > 0 ||
  filters.sources.length > 0 ||
  filters.situation.length > 0 ||
  filters.modes.length > 0;

export const filterRecurrings = (
  items: readonly RecurringResource[],
  filters: RecurringFilters,
): readonly RecurringResource[] => {
  const q = filters.q.trim().toLowerCase();
  return items.filter((item) => {
    if (q !== '' && !item.name.toLowerCase().includes(q)) return false;
    if (filters.kinds.length > 0 && !filters.kinds.includes(item.kind)) return false;
    if (
      filters.categories.length > 0 &&
      (item.category_id === null || !filters.categories.includes(item.category_id))
    )
      return false;
    if (
      filters.sources.length > 0 &&
      !filters.sources.some(
        (id) => item.source.id === id || item.second_source?.id === id,
      )
    )
      return false;
    if (
      filters.situation.length > 0 &&
      !filters.situation.includes(item.active ? 'ativo' : 'pausado')
    )
      return false;
    if (filters.modes.length > 0 && !filters.modes.includes(item.mode)) return false;
    return true;
  });
};

/** "5 ativas · 2 pausadas". */
export const summaryLabel = (items: readonly RecurringResource[]): string => {
  const active = items.filter((item) => item.active).length;
  const paused = items.length - active;
  return `${active} ${active === 1 ? 'ativa' : 'ativas'} · ${paused} ${
    paused === 1 ? 'pausada' : 'pausadas'
  }`;
};

export const activeTotal = (items: readonly RecurringResource[]): string =>
  fromCents(
    items.reduce((sum, item) => (item.active ? sum + toCents(item.amount) : sum), 0n),
  );

/**
 * Receitas − Despesas − Aportes dos itens ativos (RN-U1). A tela passa os itens
 * visíveis, então o resultado acompanha os filtros.
 */
export const monthlyResult = (items: readonly RecurringResource[]): string => {
  let result = 0n;
  for (const item of items) {
    if (!item.active) continue;
    const cents = toCents(item.amount);
    result += item.kind === 'receita' ? cents : -cents;
  }
  return fromCents(result);
};

/**
 * O peso de cada item ativo no bloco, em décimos de ponto, pelo maior resto: a
 * soma é 1000 e nenhum item some por arredondamento. Pausado não tem peso.
 */
export const blockWeights = (
  items: readonly RecurringResource[],
): ReadonlyMap<string, number> => {
  const active = items.filter((item) => item.active);
  const total = active.reduce((sum, item) => sum + toCents(item.amount), 0n);
  const weights = new Map<string, number>();
  if (total === 0n) return weights;

  const shares = active.map((item) => {
    const scaled = toCents(item.amount) * 1000n;
    return { id: item.id, floor: scaled / total, rest: scaled % total };
  });
  let left = 1000 - shares.reduce((sum, share) => sum + Number(share.floor), 0);
  const order = [...shares].sort((a, b) =>
    a.rest === b.rest ? 0 : a.rest > b.rest ? -1 : 1,
  );
  const extra = new Set<string>();
  for (const share of order) {
    if (left <= 0) break;
    extra.add(share.id);
    left -= 1;
  }
  for (const share of shares) {
    weights.set(share.id, Number(share.floor) + (extra.has(share.id) ? 1 : 0));
  }
  return weights;
};

export type RecurringGroup = {
  readonly key: string;
  readonly label: string;
  readonly kind: RecurringKind | null;
  readonly items: readonly RecurringResource[];
  readonly total: string;
  readonly weights: ReadonlyMap<string, number>;
};

/**
 * Os blocos da tabela. Por tipo, a ordem é Receitas, Despesas, Aportes; nos
 * outros agrupamentos, alfabética. Bloco vazio não aparece.
 */
export const groupRecurrings = (
  items: readonly RecurringResource[],
  by: RecurringGrouping,
  names: {
    readonly category: (id: string | null) => string;
    readonly source: (id: string) => string;
  },
): readonly RecurringGroup[] => {
  const buckets = new Map<string, { label: string; items: RecurringResource[] }>();
  const put = (key: string, label: string, item: RecurringResource): void => {
    const bucket = buckets.get(key) ?? { label, items: [] };
    bucket.items.push(item);
    buckets.set(key, bucket);
  };
  for (const item of items) {
    if (by === 'tipo') put(item.kind, KIND_LABEL[item.kind], item);
    else if (by === 'categoria') {
      put(
        item.category_id ?? 'aporte',
        item.category_id === null ? 'Aportes' : names.category(item.category_id),
        item,
      );
    } else put(item.source.id, names.source(item.source.id), item);
  }

  const groups = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: bucket.label,
    kind: by === 'tipo' ? (key as RecurringKind) : null,
    items: bucket.items,
    total: activeTotal(bucket.items),
    weights: blockWeights(bucket.items),
  }));

  return by === 'tipo'
    ? groups.sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.kind as RecurringKind) -
          KIND_ORDER.indexOf(b.kind as RecurringKind),
      )
    : groups.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
};
