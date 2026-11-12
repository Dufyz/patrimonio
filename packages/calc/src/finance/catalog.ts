import type {
  FinAccount,
  FinAccountType,
  FinCard,
  FinCategory,
  FinKind,
  FinRecurring,
  FinCategoryNature,
  FinRecurringKind,
  FinRecurringMode,
  FinSnapshot,
  FinSource,
} from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { compareDates, isIsoDate } from './dates.js';
import { rule } from './errors.js';
import type { FinRuleError } from './errors.js';
import {
  findAccount,
  findCard,
  findCategory,
  findRecurring,
  isActiveSource,
} from './lookup.js';
import { dec, money } from './money.js';

/**
 * Cadastros: categorias, contas, cartões e recorrentes. Cada operação valida,
 * devolve o snapshot novo e diz quando a entidade tem uso (T-07): com uso só se
 * arquiva; sem uso, remove.
 */

type Result<T> = Either<readonly FinRuleError[], T>;

const notFound = (code: string, message: string): FinRuleError =>
  rule(code, message, { status: 404 });

const positiveMoney = (value: string): boolean =>
  /^\d+(\.\d{1,2})?$/.test(value) && dec(value).gt(0);
const nonNegativeMoney = (value: string): boolean => /^\d+(\.\d{1,2})?$/.test(value);
const validDay = (day: number): boolean => Number.isInteger(day) && day >= 1 && day <= 31;

// ─── Categorias ──────────────────────────────────────────────────────────────

export type CategoryInput = {
  readonly name: string;
  readonly kind: FinKind;
  readonly color: string;
  readonly nature?: FinCategoryNature | null | undefined;
};

/** Receita não tem natureza; despesa pode ser fixa ou livre (CAT-04). */
const natureError = (input: CategoryInput): FinRuleError | undefined =>
  input.nature != null && input.kind !== 'despesa'
    ? rule('CATEGORY_NATURE_INVALID', 'Só despesa tem natureza.', { field: 'nature' })
    : undefined;

const nameTaken = (data: FinSnapshot, input: CategoryInput, exceptId?: string): boolean =>
  data.categories.some(
    (category) =>
      category.id !== exceptId &&
      category.kind === input.kind &&
      category.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
  );

export const categoryUsage = (data: FinSnapshot, id: string): number =>
  data.entries.filter((entry) => entry.category_id === id).length +
  data.recurrings.filter((recurring) => recurring.category_id === id).length +
  data.card_items.filter((item) => item.category_id === id).length;

export const createCategory = (
  data: FinSnapshot,
  input: CategoryInput,
  newId: () => string,
): Result<{ data: FinSnapshot; category: FinCategory }> => {
  if (input.name.trim() === '') {
    return failure([
      rule('CATEGORY_NAME_REQUIRED', 'Dê um nome à categoria.', { field: 'name' }),
    ]);
  }
  if (nameTaken(data, input)) {
    return failure([
      rule('CATEGORY_NAME_TAKEN', 'Já existe uma categoria com esse nome neste tipo.', {
        field: 'name',
        status: 409,
      }),
    ]);
  }
  const invalidNature = natureError(input);
  if (invalidNature !== undefined) return failure([invalidNature]);
  const category: FinCategory = {
    id: newId(),
    name: input.name.trim(),
    kind: input.kind,
    color: input.color,
    nature: input.kind === 'despesa' ? (input.nature ?? null) : null,
    archived: false,
    version: 1,
  };
  return success({
    data: { ...data, categories: [...data.categories, category] },
    category,
  });
};

/** Renomear e recolorir preservam o vínculo dos lançamentos; o tipo só muda sem uso. */
export const updateCategory = (
  data: FinSnapshot,
  id: string,
  input: CategoryInput,
): Result<FinSnapshot> => {
  const current = findCategory(data, id);
  if (current === undefined)
    return failure([notFound('CATEGORY_NOT_FOUND', 'Categoria não encontrada.')]);
  if (input.name.trim() === '') {
    return failure([
      rule('CATEGORY_NAME_REQUIRED', 'Dê um nome à categoria.', { field: 'name' }),
    ]);
  }
  if (nameTaken(data, input, id)) {
    return failure([
      rule('CATEGORY_NAME_TAKEN', 'Já existe uma categoria com esse nome neste tipo.', {
        field: 'name',
        status: 409,
      }),
    ]);
  }
  const invalidNature = natureError(input);
  if (invalidNature !== undefined) return failure([invalidNature]);
  if (input.kind !== current.kind && categoryUsage(data, id) > 0) {
    return failure([
      rule('CATEGORY_IN_USE', 'O tipo de uma categoria com lançamentos não muda.', {
        field: 'kind',
        status: 409,
      }),
    ]);
  }
  return success({
    ...data,
    categories: data.categories.map((category) =>
      category.id === id
        ? {
            ...category,
            name: input.name.trim(),
            kind: input.kind,
            color: input.color,
            nature: input.kind === 'despesa' ? (input.nature ?? null) : null,
          }
        : category,
    ),
  });
};

export const setCategoryArchived = (
  data: FinSnapshot,
  id: string,
  archived: boolean,
): Result<FinSnapshot> =>
  findCategory(data, id) === undefined
    ? failure([notFound('CATEGORY_NOT_FOUND', 'Categoria não encontrada.')])
    : success({
        ...data,
        categories: data.categories.map((category) =>
          category.id === id ? { ...category, archived } : category,
        ),
      });

/** Categoria com lançamentos ou recorrentes não é removida: `409 CATEGORY_IN_USE`. */
export const removeCategory = (data: FinSnapshot, id: string): Result<FinSnapshot> => {
  if (findCategory(data, id) === undefined) {
    return failure([notFound('CATEGORY_NOT_FOUND', 'Categoria não encontrada.')]);
  }
  const uses = categoryUsage(data, id);
  if (uses > 0) {
    return failure([
      rule(
        'CATEGORY_IN_USE',
        `A categoria tem ${uses} uso(s): arquive em vez de remover.`,
        {
          status: 409,
          details: { uses: String(uses) },
        },
      ),
    ]);
  }
  return success({
    ...data,
    categories: data.categories.filter((category) => category.id !== id),
  });
};

/**
 * CAT-04 · Excluir com destino: lançamentos, recorrentes e itens de fatura vão
 * para a categoria de destino e a categoria sai, tudo no mesmo snapshot — quem
 * persiste o faz numa transação só, e falha desfaz tudo.
 */
export const removeCategoryMoving = (
  data: FinSnapshot,
  id: string,
  moveTo: string,
): Result<FinSnapshot> => {
  const source = findCategory(data, id);
  if (source === undefined) {
    return failure([notFound('CATEGORY_NOT_FOUND', 'Categoria não encontrada.')]);
  }
  const target = findCategory(data, moveTo);
  if (target === undefined || moveTo === id) {
    return failure([
      rule('CATEGORY_NOT_FOUND', 'Escolha outra categoria como destino.', {
        field: 'move_to',
        status: target === undefined ? 404 : 422,
      }),
    ]);
  }
  if (target.kind !== source.kind) {
    return failure([
      rule('CATEGORY_KIND_MISMATCH', 'O destino precisa ser do mesmo tipo.', {
        field: 'move_to',
      }),
    ]);
  }
  const retarget = <T extends { readonly category_id: string | null }>(row: T): T =>
    row.category_id === id ? { ...row, category_id: moveTo } : row;
  return success({
    ...data,
    categories: data.categories.filter((category) => category.id !== id),
    entries: data.entries.map(retarget),
    recurrings: data.recurrings.map(retarget),
    card_items: data.card_items.map((item) =>
      item.category_id === id ? { ...item, category_id: moveTo } : item,
    ),
  });
};

// ─── Contas ──────────────────────────────────────────────────────────────────

export type AccountInput = {
  readonly name: string;
  readonly type: FinAccountType;
  readonly institution?: string | null | undefined;
  readonly role?: string | undefined;
  readonly role_tag?: string | null | undefined;
  readonly opening_amount: string;
  readonly opening_date: string;
};

export const validateAccount = (
  data: FinSnapshot,
  input: AccountInput,
  exceptId?: string,
): readonly FinRuleError[] => {
  const errors: FinRuleError[] = [];
  if (input.name.trim() === '') {
    errors.push(rule('ACCOUNT_NAME_REQUIRED', 'Dê um nome à conta.', { field: 'name' }));
  } else if (
    data.accounts.some(
      (account) =>
        account.id !== exceptId &&
        !account.archived &&
        account.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
    )
  ) {
    errors.push(
      rule('ACCOUNT_NAME_TAKEN', 'Já existe uma conta com esse nome.', {
        field: 'name',
        status: 409,
      }),
    );
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(input.opening_amount)) {
    errors.push(
      rule('ACCOUNT_OPENING_INVALID', 'Informe o saldo inicial.', {
        field: 'opening_amount',
      }),
    );
  }
  if (!isIsoDate(input.opening_date)) {
    errors.push(
      rule('ACCOUNT_OPENING_DATE_REQUIRED', 'Informe a data do saldo inicial.', {
        field: 'opening_date',
      }),
    );
  }

  return errors;
};

const accountFields = (input: AccountInput) => ({
  name: input.name.trim(),
  type: input.type,
  institution: input.institution ?? null,
  role: input.role ?? '',
  role_tag: input.role_tag ?? null,
  opening_amount: money(dec(input.opening_amount)),
  opening_date: input.opening_date,
});

export const createAccount = (
  data: FinSnapshot,
  input: AccountInput,
  newId: () => string,
): Result<{ data: FinSnapshot; account: FinAccount }> => {
  const errors = validateAccount(data, input);
  if (errors.length > 0) return failure(errors);
  const account: FinAccount = {
    id: newId(),
    ...accountFields(input),
    archived: false,
    version: 1,
  };
  return success({ data: { ...data, accounts: [...data.accounts, account] }, account });
};

export const updateAccount = (
  data: FinSnapshot,
  id: string,
  input: AccountInput,
): Result<FinSnapshot> => {
  const current = findAccount(data, id);
  if (current === undefined)
    return failure([notFound('ACCOUNT_NOT_FOUND', 'Conta não encontrada.')]);
  const errors = validateAccount(data, input, id);
  if (errors.length > 0) return failure(errors);
  if (input.type !== current.type && accountUsage(data, id) > 0) {
    return failure([
      rule('ACCOUNT_IN_USE', 'O tipo de uma conta com movimento não muda.', {
        field: 'type',
        status: 409,
      }),
    ]);
  }
  return success({
    ...data,
    accounts: data.accounts.map((account) =>
      account.id === id ? { ...account, ...accountFields(input) } : account,
    ),
  });
};

/** Quantas coisas apontam para a conta: lançamentos, recorrentes, cartões, pagamentos e movimentações. */
export const accountUsage = (data: FinSnapshot, id: string): number =>
  data.entries.filter((e) =>
    e.payments.some((p) => p.source_type === 'conta' && p.source_id === id),
  ).length +
  data.recurrings.filter(
    (r) =>
      (r.source.type === 'conta' && r.source.id === id) ||
      (r.second_source?.type === 'conta' && r.second_source.id === id),
  ).length +
  data.cards.filter((card) => card.pay_account_id === id).length +
  data.invoice_payments.filter((payment) => payment.account_id === id).length +
  data.movements.filter((movement) => movement.account_id === id).length;

export const setAccountArchived = (
  data: FinSnapshot,
  id: string,
  archived: boolean,
): Result<FinSnapshot> => {
  if (findAccount(data, id) === undefined) {
    return failure([notFound('ACCOUNT_NOT_FOUND', 'Conta não encontrada.')]);
  }
  if (archived) {
    const payer = data.cards.find((card) => card.pay_account_id === id && !card.archived);
    if (payer !== undefined) {
      return failure([
        rule(
          'ACCOUNT_IN_USE',
          `A conta paga a fatura do cartão ${payer.name}: troque a conta do cartão antes.`,
          {
            status: 409,
          },
        ),
      ]);
    }
  }
  return success({
    ...data,
    accounts: data.accounts.map((account) =>
      account.id === id ? { ...account, archived } : account,
    ),
  });
};

/** Conta usada só é arquivada, não removida (FIN-B-201). */
export const removeAccount = (data: FinSnapshot, id: string): Result<FinSnapshot> => {
  if (findAccount(data, id) === undefined) {
    return failure([notFound('ACCOUNT_NOT_FOUND', 'Conta não encontrada.')]);
  }
  if (accountUsage(data, id) > 0) {
    return failure([
      rule('ACCOUNT_IN_USE', 'A conta tem movimento: arquive em vez de remover.', {
        status: 409,
      }),
    ]);
  }
  return success({
    ...data,
    accounts: data.accounts.filter((account) => account.id !== id),
    movements: data.movements.filter((movement) => movement.account_id !== id),
  });
};

// ─── Cartões ─────────────────────────────────────────────────────────────────

export type CardInput = {
  readonly name: string;
  readonly last4?: string | undefined;
  readonly pay_account_id: string;
  readonly limit_amount: string;
  readonly closing_day: number;
  readonly due_day: number;
};

export const validateCard = (
  data: FinSnapshot,
  input: CardInput,
  exceptId?: string,
): readonly FinRuleError[] => {
  const errors: FinRuleError[] = [];
  if (input.name.trim() === '') {
    errors.push(rule('CARD_NAME_REQUIRED', 'Dê um nome ao cartão.', { field: 'name' }));
  } else if (
    data.cards.some(
      (card) =>
        card.id !== exceptId &&
        !card.archived &&
        card.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
    )
  ) {
    errors.push(
      rule('CARD_NAME_TAKEN', 'Já existe um cartão com esse nome.', {
        field: 'name',
        status: 409,
      }),
    );
  }
  const payer = findAccount(data, input.pay_account_id);
  if (payer === undefined || payer.archived) {
    errors.push(
      rule('CARD_PAYER_INVALID', 'Escolha uma conta ativa para pagar a fatura.', {
        field: 'pay_account_id',
      }),
    );
  }
  if (!validDay(input.closing_day)) {
    errors.push(
      rule('CARD_DAY_INVALID', 'O fechamento é um dia de 1 a 31.', {
        field: 'closing_day',
      }),
    );
  }
  if (!validDay(input.due_day)) {
    errors.push(
      rule('CARD_DAY_INVALID', 'O vencimento é um dia de 1 a 31.', { field: 'due_day' }),
    );
  }
  if (!nonNegativeMoney(input.limit_amount)) {
    errors.push(
      rule('CARD_LIMIT_INVALID', 'Informe o limite do cartão.', {
        field: 'limit_amount',
      }),
    );
  }
  if (input.last4 !== undefined && input.last4 !== '' && !/^\d{4}$/.test(input.last4)) {
    errors.push(
      rule('CARD_LAST4_INVALID', 'Informe os quatro últimos dígitos.', {
        field: 'last4',
      }),
    );
  }
  return errors;
};

export const cardUsage = (data: FinSnapshot, id: string): number =>
  data.entries.filter((e) =>
    e.payments.some((p) => p.source_type === 'cartao' && p.source_id === id),
  ).length +
  data.card_items.filter((item) => item.card_id === id).length +
  data.invoice_payments.filter((payment) => payment.card_id === id).length +
  data.recurrings.filter(
    (r) =>
      (r.source.type === 'cartao' && r.source.id === id) ||
      (r.second_source?.type === 'cartao' && r.second_source.id === id),
  ).length;

export const createCard = (
  data: FinSnapshot,
  input: CardInput,
  newId: () => string,
): Result<{ data: FinSnapshot; card: FinCard }> => {
  const errors = validateCard(data, input);
  if (errors.length > 0) return failure(errors);
  const card: FinCard = {
    id: newId(),
    name: input.name.trim(),
    last4: input.last4 ?? '',
    pay_account_id: input.pay_account_id,
    limit_amount: money(dec(input.limit_amount)),
    closing_day: input.closing_day,
    due_day: input.due_day,
    archived: false,
    version: 1,
  };
  return success({ data: { ...data, cards: [...data.cards, card] }, card });
};

/**
 * Alterar o fechamento vale para compras futuras: as partes já gravadas mantêm o
 * `invoice_month` com que nasceram, e por isso nada é reescrito aqui.
 */
export const updateCard = (
  data: FinSnapshot,
  id: string,
  input: CardInput,
): Result<FinSnapshot> => {
  if (findCard(data, id) === undefined)
    return failure([notFound('CARD_NOT_FOUND', 'Cartão não encontrado.')]);
  const errors = validateCard(data, input, id);
  if (errors.length > 0) return failure(errors);
  return success({
    ...data,
    cards: data.cards.map((card) =>
      card.id === id
        ? {
            ...card,
            name: input.name.trim(),
            last4: input.last4 ?? card.last4,
            pay_account_id: input.pay_account_id,
            limit_amount: money(dec(input.limit_amount)),
            closing_day: input.closing_day,
            due_day: input.due_day,
          }
        : card,
    ),
  });
};

export const setCardArchived = (
  data: FinSnapshot,
  id: string,
  archived: boolean,
): Result<FinSnapshot> =>
  findCard(data, id) === undefined
    ? failure([notFound('CARD_NOT_FOUND', 'Cartão não encontrado.')])
    : success({
        ...data,
        cards: data.cards.map((card) => (card.id === id ? { ...card, archived } : card)),
      });

export const removeCard = (data: FinSnapshot, id: string): Result<FinSnapshot> => {
  if (findCard(data, id) === undefined)
    return failure([notFound('CARD_NOT_FOUND', 'Cartão não encontrado.')]);
  if (cardUsage(data, id) > 0) {
    return failure([
      rule('CARD_IN_USE', 'O cartão tem itens: arquive em vez de remover.', {
        status: 409,
      }),
    ]);
  }
  return success({ ...data, cards: data.cards.filter((card) => card.id !== id) });
};

// ─── Recorrentes ─────────────────────────────────────────────────────────────

export type RecurringInput = {
  readonly name: string;
  readonly kind: FinRecurringKind;
  readonly category_id?: string | null | undefined;
  /** Só no aporte (LIV-11). */
  readonly portfolio_id?: string | null | undefined;
  readonly asset_id?: string | null | undefined;
  readonly source: FinSource;
  readonly second_source?: FinSource | null | undefined;
  readonly covers_up_to?: string | null | undefined;
  readonly day: number;
  readonly mode: FinRecurringMode;
  readonly amount: string;
  readonly active?: boolean | undefined;
};

export const validateRecurring = (
  data: FinSnapshot,
  input: RecurringInput,
): readonly FinRuleError[] => {
  const errors: FinRuleError[] = [];
  if (input.name.trim() === '') {
    errors.push(
      rule('RECURRING_NAME_REQUIRED', 'Dê um nome ao recorrente.', { field: 'name' }),
    );
  }
  if (input.kind === 'aporte') {
    // RN-U8: aporte recorrente tem carteira, origem em conta e só modo manual,
    // porque a quantidade depende do preço do dia.
    if (input.portfolio_id == null) {
      errors.push(
        rule('RECURRING_APORTE_PORTFOLIO', 'Escolha a carteira do aporte.', {
          field: 'portfolio_id',
        }),
      );
    }
    if (input.category_id != null) {
      errors.push(
        rule('RECURRING_APORTE_CATEGORY', 'Aporte não tem categoria.', {
          field: 'category_id',
        }),
      );
    }
    if (input.source.type !== 'conta') {
      errors.push(
        rule('APORTE_ORIGEM_CARTAO', 'O aporte não pode ter origem em cartão.', {
          field: 'source',
        }),
      );
    }
    if (input.mode !== 'manual') {
      errors.push(
        rule('RECURRING_APORTE_MODE', 'Aporte só existe no modo manual.', {
          field: 'mode',
        }),
      );
    }
    if (input.second_source != null) {
      errors.push(
        rule('ENTRY_SPLIT_RECEITA', 'O aporte tem uma só origem.', {
          field: 'second_source',
        }),
      );
    }
  } else {
    const category =
      input.category_id == null ? undefined : findCategory(data, input.category_id);
    if (category === undefined) {
      errors.push(
        rule('RECURRING_CATEGORY_NOT_FOUND', 'Escolha uma categoria.', {
          field: 'category_id',
        }),
      );
    } else if (category.kind !== input.kind) {
      errors.push(
        rule(
          'RECURRING_CATEGORY_KIND_MISMATCH',
          'A categoria precisa ser do mesmo tipo.',
          {
            field: 'category_id',
          },
        ),
      );
    }
  }
  if (!isActiveSource(data, input.source)) {
    errors.push(
      rule('RECURRING_SOURCE_INVALID', 'Escolha uma forma de pagamento ativa.', {
        field: 'source',
      }),
    );
  } else if (input.kind === 'receita' && input.source.type !== 'conta') {
    errors.push(
      rule('RECURRING_SOURCE_INVALID', 'Receita só aceita conta.', { field: 'source' }),
    );
  }
  if (!validDay(input.day)) {
    errors.push(
      rule('RECURRING_DAY_INVALID', 'Informe um dia de 1 a 31.', { field: 'day' }),
    );
  }
  if (!positiveMoney(input.amount)) {
    errors.push(
      rule('RECURRING_AMOUNT_INVALID', 'Informe um valor maior que zero.', {
        field: 'amount',
      }),
    );
  }

  if (input.second_source != null) {
    if (input.kind === 'receita') {
      errors.push(
        rule('ENTRY_SPLIT_RECEITA', 'Só despesa pode ter duas origens.', {
          field: 'second_source',
        }),
      );
    }
    if (!isActiveSource(data, input.second_source)) {
      errors.push(
        rule('RECURRING_SOURCE_INVALID', 'Escolha a segunda origem.', {
          field: 'second_source',
        }),
      );
    } else if (
      input.second_source.type === input.source.type &&
      input.second_source.id === input.source.id
    ) {
      errors.push(
        rule('ENTRY_SPLIT_SAME_SOURCE', 'As duas origens precisam ser diferentes.', {
          field: 'second_source',
        }),
      );
    }
    if (input.covers_up_to == null || !positiveMoney(input.covers_up_to)) {
      errors.push(
        rule('RECURRING_COVERS_INVALID', 'Informe quanto a primeira origem cobre.', {
          field: 'covers_up_to',
        }),
      );
    } else if (positiveMoney(input.amount) && dec(input.covers_up_to).gte(input.amount)) {
      errors.push(
        rule(
          'RECURRING_COVERS_INVALID',
          'A primeira origem precisa cobrir menos que o valor.',
          {
            field: 'covers_up_to',
          },
        ),
      );
    }
  } else if (input.covers_up_to != null) {
    errors.push(
      rule('RECURRING_COVERS_INVALID', 'O limite só vale com duas origens.', {
        field: 'covers_up_to',
      }),
    );
  }
  return errors;
};

const recurringFields = (input: RecurringInput) => ({
  name: input.name.trim(),
  kind: input.kind,
  category_id: input.kind === 'aporte' ? null : (input.category_id ?? null),
  portfolio_id: input.kind === 'aporte' ? (input.portfolio_id ?? null) : null,
  asset_id: input.kind === 'aporte' ? (input.asset_id ?? null) : null,
  source: input.source,
  second_source: input.second_source ?? null,
  covers_up_to:
    input.second_source == null ? null : money(dec(input.covers_up_to ?? '0')),
  day: input.day,
  mode: input.mode,
  amount: money(dec(input.amount)),
  active: input.active ?? true,
});

export const createRecurring = (
  data: FinSnapshot,
  input: RecurringInput,
  newId: () => string,
): Result<{ data: FinSnapshot; recurring: FinRecurring }> => {
  const errors = validateRecurring(data, input);
  if (errors.length > 0) return failure(errors);
  const recurring: FinRecurring = { id: newId(), ...recurringFields(input), version: 1 };
  return success({
    data: { ...data, recurrings: [...data.recurrings, recurring] },
    recurring,
  });
};

export const updateRecurringFields = (
  data: FinSnapshot,
  id: string,
  input: RecurringInput,
): Result<{ data: FinSnapshot; recurring: FinRecurring }> => {
  const current = findRecurring(data, id);
  if (current === undefined) {
    return failure([notFound('RECURRING_NOT_FOUND', 'Recorrente não encontrado.')]);
  }
  const errors = validateRecurring(data, input);
  if (errors.length > 0) return failure(errors);
  const recurring: FinRecurring = { ...current, ...recurringFields(input) };
  return success({
    data: {
      ...data,
      recurrings: data.recurrings.map((r) => (r.id === id ? recurring : r)),
    },
    recurring,
  });
};

export const setRecurringActive = (
  data: FinSnapshot,
  id: string,
  active: boolean,
): Result<{ data: FinSnapshot; recurring: FinRecurring }> => {
  const current = findRecurring(data, id);
  if (current === undefined) {
    return failure([notFound('RECURRING_NOT_FOUND', 'Recorrente não encontrado.')]);
  }
  const recurring = { ...current, active };
  return success({
    data: {
      ...data,
      recurrings: data.recurrings.map((r) => (r.id === id ? recurring : r)),
    },
    recurring,
  });
};

export { compareDates };
