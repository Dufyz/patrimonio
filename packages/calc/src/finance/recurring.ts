import type {
  FinEntry,
  FinPayment,
  FinRecurring,
  FinSnapshot,
  FinSource,
} from '@patrimonio/domain';
import type { Decimal } from 'decimal.js';

import { invoiceKeyOf } from './cards.js';
import { compareDates, dateInMonth, monthKey } from './dates.js';
import { findCard } from './lookup.js';
import { dec, min, money } from './money.js';

/**
 * Recorrentes e os previstos que eles geram (RN-10 a RN-15). Tudo puro: recebe o
 * snapshot e o "hoje" e devolve o snapshot novo. `syncRecurring` é idempotente —
 * a rotina diária e a tela podem rodá-lo quantas vezes quiserem e o resultado
 * para o mesmo dia é o mesmo.
 */

/** Uma parte de pagamento, com a fatura gravada quando a origem é cartão. */
export const makePayment = (
  data: FinSnapshot,
  source: FinSource,
  amount: Decimal,
  date: string,
): FinPayment => {
  const card = source.type === 'cartao' ? findCard(data, source.id) : undefined;
  return {
    source_type: source.type,
    source_id: source.id,
    amount: money(amount),
    invoice_month: card === undefined ? null : invoiceKeyOf(card, date),
  };
};

/** As partes do pagamento para um valor: a primeira origem até o limite, a segunda o resto. */
export const recurringPayments = (
  data: FinSnapshot,
  recurring: FinRecurring,
  amount: Decimal,
  date: string,
): readonly FinPayment[] => {
  if (recurring.second_source === null || recurring.covers_up_to === null) {
    return [makePayment(data, recurring.source, amount, date)];
  }
  const first = min(dec(recurring.covers_up_to), amount);
  const rest = amount.minus(first);
  return rest.eq(0)
    ? [makePayment(data, recurring.source, first, date)]
    : [
        makePayment(data, recurring.source, first, date),
        makePayment(data, recurring.second_source, rest, date),
      ];
};

const plannedEntry = (
  data: FinSnapshot,
  recurring: FinRecurring,
  month: string,
  id: string,
): FinEntry => {
  const date = dateInMonth(month, recurring.day);
  return {
    id,
    kind: recurring.kind,
    description: recurring.name,
    date,
    category_id: recurring.category_id,
    amount: recurring.amount,
    status: 'prevista',
    recurring_id: recurring.id,
    installment: null,
    note: null,
    payments: recurringPayments(data, recurring, dec(recurring.amount), date),
    version: 1,
  };
};

/**
 * Gera o previsto do mês corrente para cada recorrente ativo que ainda não tem
 * lançamento nele e não foi pulado, e — no modo automático — lança na data o que
 * já venceu (RN-11). Previsto manual vencido continua previsto (RN-13).
 */
export const syncRecurring = (
  data: FinSnapshot,
  today: string,
  newId: () => string,
): FinSnapshot => {
  const month = monthKey(today);
  const have = new Set(
    data.entries
      .filter((entry) => entry.recurring_id !== null && monthKey(entry.date) === month)
      .map((entry) => entry.recurring_id),
  );
  const skipped = new Set(data.skips.map((skip) => `${skip.recurring_id}:${skip.month}`));

  const generated = data.recurrings
    .filter(
      (recurring) =>
        recurring.active &&
        !have.has(recurring.id) &&
        !skipped.has(`${recurring.id}:${month}`),
    )
    .map((recurring) => plannedEntry(data, recurring, today, newId()));

  const automatic = new Set(
    data.recurrings
      .filter((recurring) => recurring.mode === 'automatico')
      .map((r) => r.id),
  );

  let changed = generated.length > 0;
  const entries = [...data.entries, ...generated].map((entry) => {
    if (
      entry.status === 'prevista' &&
      entry.recurring_id !== null &&
      automatic.has(entry.recurring_id) &&
      compareDates(entry.date, today) <= 0
    ) {
      changed = true;
      return { ...entry, status: 'lancada' as const };
    }
    return entry;
  });

  return changed ? { ...data, entries } : data;
};

const isPendingOf = (entry: FinEntry, recurringId: string): boolean =>
  entry.recurring_id === recurringId && entry.status === 'prevista';

/** RN-15: aplica o cadastro aos previstos pendentes, e só a eles. */
export const refreshPending = (
  data: FinSnapshot,
  recurring: FinRecurring,
): FinSnapshot => ({
  ...data,
  entries: data.entries.map((entry) => {
    if (!isPendingOf(entry, recurring.id)) return entry;
    const date = dateInMonth(entry.date, recurring.day);
    return {
      ...entry,
      kind: recurring.kind,
      description: recurring.name,
      category_id: recurring.category_id,
      amount: recurring.amount,
      date,
      payments: recurringPayments(data, recurring, dec(recurring.amount), date),
    };
  }),
});

/** Quais previstos pendentes a edição do recorrente alteraria, com valor antes e depois. */
export type PendingChange = {
  readonly entry_id: string;
  readonly date_before: string;
  readonly date_after: string;
  readonly amount_before: string;
  readonly amount_after: string;
};

export const pendingChanges = (
  before: FinSnapshot,
  after: FinSnapshot,
  recurringId: string,
): readonly PendingChange[] =>
  before.entries
    .filter((entry) => isPendingOf(entry, recurringId))
    .flatMap((entry) => {
      const next = after.entries.find((candidate) => candidate.id === entry.id);
      if (next === undefined) {
        return [
          {
            entry_id: entry.id,
            date_before: entry.date,
            date_after: entry.date,
            amount_before: entry.amount,
            amount_after: '0.00',
          },
        ];
      }
      return next.amount !== entry.amount || next.date !== entry.date
        ? [
            {
              entry_id: entry.id,
              date_before: entry.date,
              date_after: next.date,
              amount_before: entry.amount,
              amount_after: next.amount,
            },
          ]
        : [];
    });

/**
 * RN-14: ao desativar, os previstos pendentes do mês corrente em diante saem; ao
 * reativar, o do mês é gerado de novo.
 */
export const applyActiveEffects = (
  data: FinSnapshot,
  recurring: FinRecurring,
  today: string,
  newId: () => string,
): FinSnapshot => {
  if (recurring.active) return syncRecurring(data, today, newId);
  const month = monthKey(today);
  return {
    ...data,
    entries: data.entries.filter(
      (entry) => !(isPendingOf(entry, recurring.id) && monthKey(entry.date) >= month),
    ),
  };
};

/** Pular um mês: grava o pulo e remove o previsto pendente daquele mês. */
export const skipMonth = (
  data: FinSnapshot,
  recurringId: string,
  month: string,
): FinSnapshot => ({
  ...data,
  skips: data.skips.some((s) => s.recurring_id === recurringId && s.month === month)
    ? data.skips
    : [...data.skips, { recurring_id: recurringId, month }],
  entries: data.entries.filter(
    (entry) => !(isPendingOf(entry, recurringId) && monthKey(entry.date) === month),
  ),
});

/** RN-15: excluir remove os previstos pendentes e mantém os lançados (o vínculo é desfeito no banco). */
export const removeRecurring = (data: FinSnapshot, recurringId: string): FinSnapshot => ({
  ...data,
  recurrings: data.recurrings.filter((recurring) => recurring.id !== recurringId),
  skips: data.skips.filter((skip) => skip.recurring_id !== recurringId),
  entries: data.entries
    .filter((entry) => !isPendingOf(entry, recurringId))
    .map((entry) =>
      entry.recurring_id === recurringId ? { ...entry, recurring_id: null } : entry,
    ),
});
