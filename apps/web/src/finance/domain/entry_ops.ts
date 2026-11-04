import { compareDates } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { parseMoneyInput } from '../lib/format.js';
import type { Cents } from '../lib/money.js';
import { SOURCES } from './sources.js';
import type { Entry, EntryKind, FinanceData, Payment } from './types.js';

/**
 * Criar, lançar e corrigir lançamentos (FIN-306 a FIN-308).
 *
 * Regras: RN-01 (campos obrigatórios), RN-03 (só hoje ou passado), RN-20 e RN-21
 * (até duas origens, soma exata), RN-12 ("Lançar" não mexe no recorrente).
 */

export type EntryDraft = {
  readonly kind: EntryKind;
  readonly description: string;
  readonly date: IsoDate;
  readonly categoryId: string;
  /** Texto do campo de dinheiro: o valor total. */
  readonly value: string;
  readonly sourceId: string;
  readonly split: boolean;
  /** Com divisão: a parte da primeira origem e a da segunda. */
  readonly firstValue: string;
  readonly secondSourceId: string;
  readonly secondValue: string;
};

export type EntryErrors = Partial<
  Record<
    | 'description'
    | 'date'
    | 'categoryId'
    | 'value'
    | 'sourceId'
    | 'secondSourceId'
    | 'firstValue'
    | 'secondValue'
    | 'sum',
    string
  >
>;

export const FUTURE_DATE = 'Data futura não vira lançamento: crie um recorrente.';

const toInput = (cents: Cents): string => (cents / 100).toFixed(2).replace('.', ',');

export const emptyEntryDraft = (today: IsoDate): EntryDraft => ({
  kind: 'despesa',
  description: '',
  date: today,
  categoryId: '',
  value: '',
  sourceId: '',
  split: false,
  firstValue: '',
  secondSourceId: '',
  secondValue: '',
});

/** O rascunho de um lançamento existente; a data de um previsto futuro vira hoje (FIN-306). */
export const draftOfEntry = (entry: Entry, today: IsoDate): EntryDraft => {
  const [first, second] = entry.payments;
  return {
    kind: entry.kind,
    description: entry.description,
    date: compareDates(entry.date, today) > 0 ? today : entry.date,
    categoryId: entry.categoryId,
    value: toInput(entry.cents),
    sourceId: first?.sourceId ?? '',
    split: second !== undefined,
    firstValue: second === undefined || first === undefined ? '' : toInput(first.cents),
    secondSourceId: second?.sourceId ?? '',
    secondValue: second === undefined ? '' : toInput(second.cents),
  };
};

/** Só conta recebe receita; despesa sai de conta, benefício ou cartão (RN-01, FIN-307). */
export const allowedSources = (kind: EntryKind) =>
  SOURCES.filter((source) => kind === 'despesa' || source.type === 'conta');

/** A diferença entre o valor e a soma das partes, em tempo real (RN-21). */
export const splitDifference = (draft: EntryDraft): Cents | null => {
  const total = parseMoneyInput(draft.value);
  const first = parseMoneyInput(draft.firstValue);
  const second = parseMoneyInput(draft.secondValue);
  if (!draft.split || total === null) return null;
  return total - (first ?? 0) - (second ?? 0);
};

export const validateEntry = (
  data: FinanceData,
  draft: EntryDraft,
  today: IsoDate,
): EntryErrors => {
  const errors: Record<string, string> = {};
  if (draft.description.trim() === '') errors['description'] = 'Dê uma descrição.';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors['date'] = 'Informe a data.';
  else if (compareDates(draft.date, today) > 0) errors['date'] = FUTURE_DATE;

  const category = data.categories.find((c) => c.id === draft.categoryId);
  if (category === undefined) errors['categoryId'] = 'Escolha uma categoria.';
  else if (category.kind !== draft.kind) {
    errors['categoryId'] = 'A categoria precisa ser do mesmo tipo.';
  }

  const total = parseMoneyInput(draft.value);
  if (total === null || total <= 0) errors['value'] = 'Informe um valor maior que zero.';

  const allowed = allowedSources(draft.kind);
  if (draft.sourceId === '') errors['sourceId'] = 'Escolha a origem do pagamento.';
  else if (!allowed.some((s) => s.id === draft.sourceId)) {
    errors['sourceId'] = 'Receita só aceita conta ou Carteira.';
  }

  if (draft.split) {
    if (draft.kind === 'receita') errors['sum'] = 'Só despesa pode ter duas origens.';
    if (draft.secondSourceId === '')
      errors['secondSourceId'] = 'Escolha a segunda origem.';
    else if (draft.secondSourceId === draft.sourceId) {
      errors['secondSourceId'] = 'As duas origens precisam ser diferentes.';
    }
    const first = parseMoneyInput(draft.firstValue);
    const second = parseMoneyInput(draft.secondValue);
    if (first === null || first <= 0)
      errors['firstValue'] = 'Informe a parte desta origem.';
    if (second === null || second <= 0)
      errors['secondValue'] = 'Informe a parte desta origem.';
    const diff = splitDifference(draft);
    if (
      diff !== null &&
      diff !== 0 &&
      errors['firstValue'] === undefined &&
      errors['secondValue'] === undefined
    ) {
      errors['sum'] = 'A soma das partes precisa ser igual ao valor.';
    }
  }
  return errors;
};

export const paymentsOf = (draft: EntryDraft): readonly Payment[] => {
  const total = parseMoneyInput(draft.value) ?? 0;
  if (!draft.split) return [{ sourceId: draft.sourceId, cents: total }];
  return [
    { sourceId: draft.sourceId, cents: parseMoneyInput(draft.firstValue) ?? 0 },
    { sourceId: draft.secondSourceId, cents: parseMoneyInput(draft.secondValue) ?? 0 },
  ];
};

/**
 * FIN-306 · Lançar um previsto com o valor real. A linha passa a lançada, no
 * dia real, e o cadastro do recorrente não muda (RN-12).
 */
export const launchEntry = (
  data: FinanceData,
  id: string,
  draft: EntryDraft,
  today: IsoDate,
): FinanceData => {
  const current = data.entries.find((entry) => entry.id === id);
  if (current === undefined || current.status !== 'prevista') return data;
  if (Object.keys(validateEntry(data, draft, today)).length > 0) return data;
  return {
    ...data,
    entries: data.entries.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            status: 'lancada' as const,
            date: draft.date,
            cents: parseMoneyInput(draft.value) ?? entry.cents,
            payments: paymentsOf(draft),
          }
        : entry,
    ),
  };
};
