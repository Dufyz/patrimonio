import type {
  FinEntry,
  FinEntryStatus,
  FinKind,
  FinPayment,
  FinSnapshot,
  FinSource,
} from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';
import type { Decimal } from 'decimal.js';

import { addMonths, compareDates, isIsoDate, monthKey } from './dates.js';
import { rule } from './errors.js';
import type { FinRuleError } from './errors.js';
import {
  findAccount,
  findCard,
  findCategory,
  findEntry,
  isActiveSource,
} from './lookup.js';
import { dec, min, money, splitInstallments, total } from './money.js';
import { makePayment } from './recurring.js';

/**
 * Criar, lançar e corrigir lançamentos.
 *
 * Regras: RN-01 (campos obrigatórios), RN-20 e RN-21 (até duas origens, soma
 * exata), RN-45 (parcelas), RN-12 ("confirmar" não mexe no recorrente). Toda
 * função devolve o snapshot novo ou as falhas de regra — o preview e a gravação
 * chamam a mesma função (T-03).
 */

export type PaymentDraft = {
  readonly source_type: FinSource['type'];
  readonly source_id: string;
  /** Ausente: completa sozinho — o valor total, ou o que falta para fechar a divisão. */
  readonly amount?: string | undefined;
};

export type EntryDraft = {
  readonly kind: FinKind;
  readonly description: string;
  readonly date: string;
  readonly category_id: string;
  readonly amount: string;
  readonly payments: readonly PaymentDraft[];
  /** Compra parcelada: de 1 (à vista) a 24, só despesa de uma origem de cartão. */
  readonly installments?: number | undefined;
  /** `prevista` força previsto mesmo com data de hoje ou passada. */
  readonly status?: FinEntryStatus | undefined;
  readonly note?: string | null | undefined;
};

export type ResolvedPayment = {
  readonly source: FinSource;
  readonly amount: Decimal;
};

const validAmount = (value: string): boolean =>
  /^\d+(\.\d{1,2})?$/.test(value) && dec(value).gt(0);

/**
 * Completa as partes do pagamento: com uma origem, ela leva o valor total; com
 * duas, informar uma parte completa a outra (RN-21). A divisão que não fecha
 * devolve `ENTRY_SPLIT_MISMATCH` com o quanto falta.
 */
export const resolvePayments = (
  draft: EntryDraft,
): Either<FinRuleError[], readonly ResolvedPayment[]> => {
  const totalAmount = validAmount(draft.amount) ? dec(draft.amount) : null;
  const errors: FinRuleError[] = [];

  if (draft.payments.length < 1 || draft.payments.length > 2) {
    return failure([
      rule('ENTRY_SOURCE_REQUIRED', 'Escolha a origem do pagamento (até duas).', {
        field: 'payments',
      }),
    ]);
  }
  if (totalAmount === null) return success([]);

  const [first, second] = draft.payments as readonly [
    PaymentDraft,
    PaymentDraft | undefined,
  ];

  if (second === undefined) {
    if (first.amount !== undefined && !dec(first.amount).eq(totalAmount)) {
      errors.push(
        rule(
          'ENTRY_SPLIT_MISMATCH',
          'O valor da origem precisa ser igual ao valor do lançamento.',
          {
            field: 'payments',
            details: { missing: money(totalAmount.minus(first.amount)) },
          },
        ),
      );
    }
    return errors.length > 0
      ? failure(errors)
      : success([
          {
            source: { type: first.source_type, id: first.source_id },
            amount: totalAmount,
          },
        ]);
  }

  if (first.source_type === second.source_type && first.source_id === second.source_id) {
    return failure([
      rule('ENTRY_SPLIT_SAME_SOURCE', 'As duas origens precisam ser diferentes.', {
        field: 'payments',
      }),
    ]);
  }

  const a = first.amount === undefined ? null : dec(first.amount);
  const b = second.amount === undefined ? null : dec(second.amount);
  const firstAmount = a ?? (b === null ? null : totalAmount.minus(b));
  const secondAmount = b ?? (a === null ? null : totalAmount.minus(a));

  if (firstAmount === null || secondAmount === null) {
    return failure([
      rule('ENTRY_SPLIT_MISMATCH', 'Informe a parte de pelo menos uma das origens.', {
        field: 'payments',
        details: { missing: money(totalAmount) },
      }),
    ]);
  }
  if (firstAmount.lte(0) || secondAmount.lte(0)) {
    return failure([
      rule(
        'ENTRY_SPLIT_MISMATCH',
        'Cada origem precisa cobrir uma parte maior que zero.',
        {
          field: 'payments',
          details: { missing: money(totalAmount.minus(firstAmount).minus(secondAmount)) },
        },
      ),
    ]);
  }
  const missing = totalAmount.minus(firstAmount).minus(secondAmount);
  if (!missing.eq(0)) {
    return failure([
      rule('ENTRY_SPLIT_MISMATCH', 'A soma das partes precisa ser igual ao valor.', {
        field: 'payments',
        details: { missing: money(missing) },
      }),
    ]);
  }

  return success([
    { source: { type: first.source_type, id: first.source_id }, amount: firstAmount },
    { source: { type: second.source_type, id: second.source_id }, amount: secondAmount },
  ]);
};

/** Parcelamento só existe em despesa paga no cartão, com uma origem. */
export const isInstallable = (draft: EntryDraft): boolean =>
  draft.kind === 'despesa' &&
  draft.payments.length === 1 &&
  draft.payments[0]?.source_type === 'cartao';

export const installmentCount = (draft: EntryDraft): number =>
  isInstallable(draft) ? (draft.installments ?? 1) : 1;

export const validateEntryDraft = (
  data: FinSnapshot,
  draft: EntryDraft,
  options: { readonly allowArchivedCategoryId?: string | undefined } = {},
): readonly FinRuleError[] => {
  const errors: FinRuleError[] = [];

  if (draft.description.trim() === '') {
    errors.push(
      rule('ENTRY_DESCRIPTION_REQUIRED', 'Dê uma descrição.', { field: 'description' }),
    );
  }
  if (!isIsoDate(draft.date)) {
    errors.push(rule('ENTRY_DATE_INVALID', 'Informe a data.', { field: 'date' }));
  }

  const category = findCategory(data, draft.category_id);
  if (category === undefined) {
    errors.push(
      rule('ENTRY_CATEGORY_NOT_FOUND', 'Escolha uma categoria.', {
        field: 'category_id',
      }),
    );
  } else if (category.kind !== draft.kind) {
    errors.push(
      rule('ENTRY_CATEGORY_KIND_MISMATCH', 'A categoria precisa ser do mesmo tipo.', {
        field: 'category_id',
      }),
    );
  } else if (category.archived && category.id !== options.allowArchivedCategoryId) {
    errors.push(
      rule(
        'ENTRY_CATEGORY_ARCHIVED',
        'Categoria arquivada não aceita lançamentos novos.',
        {
          field: 'category_id',
        },
      ),
    );
  }

  if (!validAmount(draft.amount)) {
    errors.push(
      rule('ENTRY_AMOUNT_INVALID', 'Informe um valor maior que zero.', {
        field: 'amount',
      }),
    );
  }

  for (const payment of draft.payments) {
    const source: FinSource = { type: payment.source_type, id: payment.source_id };
    const exists =
      source.type === 'conta'
        ? findAccount(data, source.id) !== undefined
        : findCard(data, source.id) !== undefined;
    if (!exists) {
      errors.push(
        rule('ENTRY_SOURCE_NOT_FOUND', 'Origem de pagamento não encontrada.', {
          field: 'payments',
        }),
      );
    } else if (!isActiveSource(data, source)) {
      errors.push(
        rule('ENTRY_SOURCE_ARCHIVED', 'Origem arquivada não recebe lançamentos novos.', {
          field: 'payments',
        }),
      );
    } else if (draft.kind === 'receita' && source.type !== 'conta') {
      errors.push(
        rule('ENTRY_RECEITA_SOURCE_INVALID', 'Receita só aceita conta ou carteira.', {
          field: 'payments',
        }),
      );
    }
  }
  if (draft.kind === 'receita' && draft.payments.length > 1) {
    errors.push(
      rule('ENTRY_SPLIT_RECEITA', 'Só despesa pode ter duas origens.', {
        field: 'payments',
      }),
    );
  }

  const count = draft.installments ?? 1;
  if (count !== 1) {
    if (!isInstallable(draft)) {
      errors.push(
        rule(
          'ENTRY_INSTALLMENTS_INVALID',
          'Só compra no cartão, com uma origem, pode ser parcelada.',
          {
            field: 'installments',
          },
        ),
      );
    } else if (!Number.isInteger(count) || count < 1 || count > 24) {
      errors.push(
        rule('ENTRY_INSTALLMENTS_INVALID', 'Informe de 1 a 24 parcelas.', {
          field: 'installments',
        }),
      );
    }
  }

  if (errors.length === 0) {
    const resolved = resolvePayments(draft);
    if (resolved.isFailure()) errors.push(...resolved.value);
  }
  return errors;
};

/** Hoje ou passado vira lançado; data futura, ou pedido explícito, vira previsto. */
export const initialStatus = (
  date: string,
  today: string,
  requested: FinEntryStatus | undefined,
): FinEntryStatus =>
  requested === 'prevista' || compareDates(date, today) > 0 ? 'prevista' : 'lancada';

const buildPayments = (
  data: FinSnapshot,
  resolved: readonly ResolvedPayment[],
  date: string,
): readonly FinPayment[] =>
  resolved.map((part) => makePayment(data, part.source, part.amount, date));

export type CreatedEntries = {
  readonly data: FinSnapshot;
  readonly created: readonly FinEntry[];
};

/**
 * Novo lançamento. Compra parcelada no cartão vira N parcelas mensais de valor
 * igual, com o resto de centavos na primeira (RN-45); cada parcela cai na fatura
 * do seu mês.
 */
export const createEntries = (
  data: FinSnapshot,
  draft: EntryDraft,
  today: string,
  newId: () => string,
): Either<readonly FinRuleError[], CreatedEntries> => {
  const errors = validateEntryDraft(data, draft);
  if (errors.length > 0) return failure(errors);

  const resolved = resolvePayments(draft);
  if (resolved.isFailure()) return failure(resolved.value);

  const count = installmentCount(draft);
  const base = {
    kind: draft.kind,
    description: draft.description.trim(),
    category_id: draft.category_id,
    recurring_id: null,
    note: draft.note ?? null,
    version: 1,
  };

  if (count < 2) {
    const entry: FinEntry = {
      ...base,
      id: newId(),
      date: draft.date,
      amount: money(dec(draft.amount)),
      status: initialStatus(draft.date, today, draft.status),
      installment: null,
      payments: buildPayments(data, resolved.value, draft.date),
    };
    return success({
      data: { ...data, entries: [...data.entries, entry] },
      created: [entry],
    });
  }

  const source = resolved.value[0]?.source as FinSource;
  const groupId = newId();
  const created = splitInstallments(dec(draft.amount), count).map(
    (amount, index): FinEntry => {
      const date = addMonths(draft.date, index);
      return {
        ...base,
        id: newId(),
        date,
        amount: money(amount),
        status: initialStatus(date, today, draft.status),
        installment: {
          group_id: groupId,
          no: index + 1,
          total: count,
          origin: draft.date,
        },
        payments: [makePayment(data, source, amount, date)],
      };
    },
  );
  return success({ data: { ...data, entries: [...data.entries, ...created] }, created });
};

/** Os campos de um lançamento que a edição troca; datas e parcelamento ficam por conta de quem chama. */
const applyDraft = (
  data: FinSnapshot,
  entry: FinEntry,
  draft: EntryDraft,
  keepDate: boolean,
): FinEntry => {
  const resolved = resolvePayments(draft);
  const date = keepDate ? entry.date : draft.date;
  const parts = resolved.isSuccess() ? resolved.value : [];
  return {
    ...entry,
    kind: draft.kind,
    description: draft.description.trim(),
    date,
    category_id: draft.category_id,
    amount: money(dec(draft.amount)),
    payments: buildPayments(data, parts, date),
    note: draft.note === undefined ? entry.note : draft.note,
  };
};

/** Editar um lançamento avulso (ou uma só parcela). A categoria atual é aceita mesmo arquivada. */
export const updateEntry = (
  data: FinSnapshot,
  id: string,
  draft: EntryDraft,
  today: string,
): Either<readonly FinRuleError[], FinSnapshot> => {
  const current = findEntry(data, id);
  if (current === undefined) {
    return failure([
      rule('ENTRY_NOT_FOUND', 'Lançamento não encontrado.', { status: 404 }),
    ]);
  }
  const errors = validateEntryDraft(data, draft, {
    allowArchivedCategoryId: current.category_id,
  });
  if (errors.length > 0) return failure(errors);

  const status =
    draft.status === undefined
      ? current.status
      : initialStatus(draft.date, today, draft.status);
  const next = { ...applyDraft(data, current, draft, false), status };
  return success({
    ...data,
    entries: data.entries.map((entry) => (entry.id === id ? next : entry)),
  });
};

export type ConfirmInput = {
  readonly date?: string | undefined;
  readonly amount?: string | undefined;
  readonly payments?: readonly PaymentDraft[] | undefined;
};

/**
 * Confirmar um previsto com o valor e a data reais (RN-12): a linha passa a
 * lançada e o cadastro do recorrente não muda. Confirmar de novo devolve o mesmo
 * snapshot — nenhum efeito é aplicado duas vezes.
 */
export const confirmEntry = (
  data: FinSnapshot,
  id: string,
  input: ConfirmInput,
  today: string,
): Either<readonly FinRuleError[], FinSnapshot> => {
  const current = findEntry(data, id);
  if (current === undefined) {
    return failure([
      rule('ENTRY_NOT_FOUND', 'Lançamento não encontrado.', { status: 404 }),
    ]);
  }
  if (current.status === 'lancada') return success(data);

  const date =
    input.date ?? (compareDates(current.date, today) <= 0 ? current.date : today);
  if (!isIsoDate(date) || compareDates(date, today) > 0) {
    return failure([
      rule('ENTRY_DATE_INVALID', 'A data real não pode ser futura.', { field: 'date' }),
    ]);
  }

  const amount = input.amount ?? current.amount;
  const payments: readonly PaymentDraft[] =
    input.payments ?? rescale(current, dec(amount));

  const draft: EntryDraft = {
    kind: current.kind,
    description: current.description,
    date,
    category_id: current.category_id,
    amount,
    payments,
    status: 'lancada',
  };
  const errors = validateEntryDraft(data, draft, {
    allowArchivedCategoryId: current.category_id,
  });
  if (errors.length > 0) return failure(errors);

  const next: FinEntry = {
    ...applyDraft(data, current, draft, false),
    status: 'lancada',
  };
  return success({
    ...data,
    entries: data.entries.map((entry) => (entry.id === id ? next : entry)),
  });
};

/** As partes atuais ajustadas a um valor novo: a primeira cede, a segunda leva o resto. */
const rescale = (entry: FinEntry, amount: Decimal): readonly PaymentDraft[] => {
  const [first, second] = entry.payments;
  if (first === undefined) return [];
  if (second === undefined) {
    return [
      {
        source_type: first.source_type,
        source_id: first.source_id,
        amount: money(amount),
      },
    ];
  }
  const firstPart = min(dec(first.amount), amount);
  const rest = amount.minus(firstPart);
  return rest.eq(0)
    ? [
        {
          source_type: first.source_type,
          source_id: first.source_id,
          amount: money(firstPart),
        },
      ]
    : [
        {
          source_type: first.source_type,
          source_id: first.source_id,
          amount: money(firstPart),
        },
        {
          source_type: second.source_type,
          source_id: second.source_id,
          amount: money(rest),
        },
      ];
};

/**
 * Excluir reverte o efeito em saldo e fatura (RN-06). Se veio de um recorrente, o
 * previsto do mês não é regenerado: grava-se o pulo daquele mês.
 */
export const deleteEntries = (data: FinSnapshot, ids: readonly string[]): FinSnapshot => {
  const doomed = data.entries.filter((entry) => ids.includes(entry.id));
  if (doomed.length === 0) return data;

  const skips = doomed
    .filter((entry) => entry.recurring_id !== null)
    .map((entry) => ({
      recurring_id: entry.recurring_id as string,
      month: monthKey(entry.date),
    }))
    .filter(
      (skip) =>
        !data.skips.some(
          (s) => s.recurring_id === skip.recurring_id && s.month === skip.month,
        ),
    );

  return {
    ...data,
    entries: data.entries.filter((entry) => !ids.includes(entry.id)),
    skips: [...data.skips, ...skips],
  };
};

export const entryTotal = (entries: readonly FinEntry[]): Decimal =>
  total(entries.map((entry) => dec(entry.amount)));
