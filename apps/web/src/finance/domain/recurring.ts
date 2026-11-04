import { compareDates, daysInMonth, monthKey, parseIso, toIso } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { parseMoneyInput } from '../lib/format.js';
import type { Cents } from '../lib/money.js';
import type {
  Entry,
  EntryKind,
  FinanceData,
  Payment,
  Recurring,
  RecurringMode,
} from './types.js';

/**
 * Recorrentes e os previstos que eles geram (RN-10 a RN-15).
 *
 * Tudo puro: recebe os dados e o "hoje" e devolve os dados novos. `syncRecurring`
 * é idempotente — roda na abertura da tela e sempre produz o mesmo resultado
 * para o mesmo dia.
 */

/** O dia do recorrente dentro de um mês; dia 31 em mês curto cai no último (RN-10). */
export const dateInMonth = (monthStartOrAny: IsoDate, day: number): IsoDate => {
  const { year, month } = parseIso(monthStartOrAny);
  return toIso(year, month, Math.min(day, daysInMonth(year, month)));
};

/** As partes do pagamento para um valor: a primeira origem até o limite, a segunda o resto. */
export const paymentsFor = (recurring: Recurring, cents: Cents): readonly Payment[] => {
  if (recurring.secondSourceId === undefined || recurring.coversUpTo === undefined) {
    return [{ sourceId: recurring.sourceId, cents }];
  }
  const first = Math.min(recurring.coversUpTo, cents);
  const rest = cents - first;
  return rest === 0
    ? [{ sourceId: recurring.sourceId, cents: first }]
    : [
        { sourceId: recurring.sourceId, cents: first },
        { sourceId: recurring.secondSourceId, cents: rest },
      ];
};

const previstoFor = (recurring: Recurring, month: IsoDate): Entry => {
  const date = dateInMonth(month, recurring.day);
  return {
    id: `p-${recurring.id}-${monthKey(date)}`,
    kind: recurring.kind,
    date,
    description: recurring.name,
    categoryId: recurring.categoryId,
    cents: recurring.cents,
    status: 'prevista',
    recurringId: recurring.id,
    payments: paymentsFor(recurring, recurring.cents),
  };
};

/**
 * Gera o previsto do mês corrente para cada recorrente ativo que ainda não tem
 * lançamento nele e, no modo automático, lança na data o que já venceu (RN-11).
 * Previsto manual vencido continua previsto (RN-13).
 */
export const syncRecurring = (data: FinanceData, today: IsoDate): FinanceData => {
  const month = monthKey(today);
  const have = new Set(
    data.entries
      .filter(
        (entry) => entry.recurringId !== undefined && monthKey(entry.date) === month,
      )
      .map((entry) => entry.recurringId),
  );

  const generated = data.recurrings
    .filter((recurring) => recurring.active && !have.has(recurring.id))
    .map((recurring) => previstoFor(recurring, today));

  const automatic = new Set(
    data.recurrings.filter((r) => r.mode === 'automatico').map((r) => r.id),
  );
  let changed = generated.length > 0;
  const settled = [...data.entries, ...generated].map((entry) => {
    if (
      entry.status === 'prevista' &&
      entry.recurringId !== undefined &&
      automatic.has(entry.recurringId) &&
      compareDates(entry.date, today) <= 0
    ) {
      changed = true;
      return { ...entry, status: 'lancada' as const };
    }
    return entry;
  });

  return changed ? { ...data, entries: settled } : data;
};

/** RN-14 e RN-15: os previstos pendentes de um recorrente. */
const pendingOf = (entry: Entry, recurringId: string): boolean =>
  entry.recurringId === recurringId && entry.status === 'prevista';

export type RecurringDraft = {
  readonly name: string;
  readonly kind: EntryKind;
  readonly categoryId: string;
  readonly sourceId: string;
  readonly split: boolean;
  readonly secondSourceId: string;
  /** Texto do campo de dinheiro. */
  readonly coversUpTo: string;
  readonly day: string;
  readonly mode: RecurringMode;
  readonly value: string;
  readonly active: boolean;
};

export type RecurringErrors = Partial<
  Record<
    | 'name'
    | 'categoryId'
    | 'sourceId'
    | 'secondSourceId'
    | 'coversUpTo'
    | 'day'
    | 'value',
    string
  >
>;

export const validateRecurring = (
  data: FinanceData,
  draft: RecurringDraft,
): RecurringErrors => {
  const errors: Record<string, string> = {};
  if (draft.name.trim() === '') errors['name'] = 'Dê um nome ao recorrente.';

  const category = data.categories.find((c) => c.id === draft.categoryId);
  if (category === undefined) errors['categoryId'] = 'Escolha uma categoria.';
  else if (category.kind !== draft.kind) {
    errors['categoryId'] = 'A categoria precisa ser do mesmo tipo.';
  }

  if (draft.sourceId === '') errors['sourceId'] = 'Escolha a forma de pagamento.';

  const day = Number(draft.day);
  if (!/^\d+$/.test(draft.day) || day < 1 || day > 31) {
    errors['day'] = 'Informe um dia de 1 a 31.';
  }

  const value = parseMoneyInput(draft.value);
  if (value === null || value <= 0) errors['value'] = 'Informe um valor maior que zero.';

  if (draft.split) {
    if (draft.secondSourceId === '')
      errors['secondSourceId'] = 'Escolha a segunda origem.';
    else if (draft.secondSourceId === draft.sourceId) {
      errors['secondSourceId'] = 'As duas origens precisam ser diferentes.';
    }
    const cap = parseMoneyInput(draft.coversUpTo);
    if (cap === null || cap <= 0)
      errors['coversUpTo'] = 'Informe quanto a primeira origem cobre.';
    else if (value !== null && cap >= value) {
      errors['coversUpTo'] = 'A primeira origem precisa cobrir menos que o valor.';
    }
  }
  return errors;
};

const fromDraft = (id: string, draft: RecurringDraft): Recurring => {
  const base = {
    id,
    name: draft.name.trim(),
    kind: draft.kind,
    categoryId: draft.categoryId,
    sourceId: draft.sourceId,
    day: Number(draft.day),
    mode: draft.mode,
    cents: parseMoneyInput(draft.value) ?? 0,
    active: draft.active,
  };
  const cap = parseMoneyInput(draft.coversUpTo);
  return draft.split && cap !== null
    ? { ...base, secondSourceId: draft.secondSourceId, coversUpTo: cap }
    : base;
};

export const draftOf = (
  recurring: Recurring | undefined,
  kind: EntryKind = 'despesa',
): RecurringDraft => ({
  name: recurring?.name ?? '',
  kind: recurring?.kind ?? kind,
  categoryId: recurring?.categoryId ?? '',
  sourceId: recurring?.sourceId ?? '',
  split: recurring?.secondSourceId !== undefined,
  secondSourceId: recurring?.secondSourceId ?? '',
  coversUpTo:
    recurring?.coversUpTo === undefined
      ? ''
      : (recurring.coversUpTo / 100).toFixed(2).replace('.', ','),
  day: recurring === undefined ? '' : String(recurring.day),
  mode: recurring?.mode ?? 'automatico',
  value:
    recurring === undefined ? '' : (recurring.cents / 100).toFixed(2).replace('.', ','),
  active: recurring?.active ?? true,
});

const nextId = (data: FinanceData, name: string): string => {
  const base = `r-${
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'recorrente'
  }`;
  const ids = new Set(data.recurrings.map((r) => r.id));
  let id = base;
  for (let n = 2; ids.has(id); n += 1) id = `${base}-${n}`;
  return id;
};

/** Aplica o cadastro aos previstos pendentes: é o que RN-15 manda editar. */
const refreshPending = (
  entries: readonly Entry[],
  recurring: Recurring,
): readonly Entry[] =>
  entries.map((entry) =>
    pendingOf(entry, recurring.id)
      ? {
          ...entry,
          kind: recurring.kind,
          description: recurring.name,
          categoryId: recurring.categoryId,
          cents: recurring.cents,
          date: dateInMonth(entry.date, recurring.day),
          payments: paymentsFor(recurring, recurring.cents),
        }
      : entry,
  );

export const addRecurring = (
  data: FinanceData,
  draft: RecurringDraft,
  today: IsoDate,
): FinanceData => {
  if (Object.keys(validateRecurring(data, draft)).length > 0) return data;
  const recurring = fromDraft(nextId(data, draft.name), draft);
  return syncRecurring({ ...data, recurrings: [...data.recurrings, recurring] }, today);
};

/**
 * RN-15: editar atualiza só os previstos pendentes. RN-14: ao desativar, os
 * pendentes do mês corrente em diante saem; ao reativar, o do mês é gerado de novo.
 */
export const updateRecurring = (
  data: FinanceData,
  id: string,
  draft: RecurringDraft,
  today: IsoDate,
): FinanceData => {
  if (!data.recurrings.some((r) => r.id === id)) return data;
  if (Object.keys(validateRecurring(data, draft)).length > 0) return data;
  const next = fromDraft(id, draft);
  const recurrings = data.recurrings.map((r) => (r.id === id ? next : r));
  return setActiveEffects(
    { ...data, recurrings, entries: refreshPending(data.entries, next) },
    next,
    today,
  );
};

export const setRecurringActive = (
  data: FinanceData,
  id: string,
  active: boolean,
  today: IsoDate,
): FinanceData => {
  const current = data.recurrings.find((r) => r.id === id);
  if (current === undefined || current.active === active) return data;
  const next = { ...current, active };
  return setActiveEffects(
    { ...data, recurrings: data.recurrings.map((r) => (r.id === id ? next : r)) },
    next,
    today,
  );
};

const setActiveEffects = (
  data: FinanceData,
  recurring: Recurring,
  today: IsoDate,
): FinanceData => {
  if (recurring.active) return syncRecurring(data, today);
  const month = monthKey(today);
  return {
    ...data,
    entries: data.entries.filter(
      (entry) => !(pendingOf(entry, recurring.id) && monthKey(entry.date) >= month),
    ),
  };
};

/** RN-15: excluir remove os previstos pendentes e mantém os lançados. */
export const deleteRecurring = (data: FinanceData, id: string): FinanceData => ({
  ...data,
  recurrings: data.recurrings.filter((r) => r.id !== id),
  entries: data.entries.filter((entry) => !pendingOf(entry, id)),
});
