import {
  confirmPayoutSchema,
  createCashMovementSchema,
  createPayoutSchema,
  createTransactionSchema,
  updateTransactionSchema,
} from '@patrimonio/contracts';
import type {
  ConfirmPayoutBody,
  Settings,
  CreateCashMovementBody,
  CreatePayoutBody,
  CreateTransactionBody,
  TransactionPreviewResource,
  TransactionResource,
  UpdateTransactionBody,
} from '@patrimonio/contracts';
import type { PayoutKind } from '@patrimonio/domain';

import { compareDecimal, parseDecimal } from './decimal.js';
import { parseAmountInput } from './positions.js';

/**
 * T-10 · O que os formulários de lançamento decidem por conta própria.
 *
 * O formulário é um espelho do contrato da `api`: cada campo digitado vira o
 * corpo que o schema da operação aceita, e o schema é o mesmo que a `api` usa.
 * Nenhuma regra de validação é reescrita aqui — o que esta camada acrescenta é
 * o que só o navegador sabe: ler `36,84` como decimal, saber qual campo da
 * tela corresponde a qual chave do corpo, e dizer o erro no campo certo.
 *
 * Nada aqui faz conta com dinheiro. O total da operação, o preço médio novo, o
 * resultado realizado, o IR retido: todos vêm do preview da `api`, que é o mesmo
 * plano que grava. Um preview calculado na tela seria uma segunda resposta para
 * a mesma pergunta, e a primeira vez que divergissem a confiança no app acabava.
 */

/** Os campos do formulário, na língua da tela — não as chaves do corpo. */
export type EntryField =
  | 'asset'
  | 'date'
  | 'settlement'
  | 'quantity'
  | 'price'
  | 'fees'
  | 'portfolio'
  | 'institution'
  | 'note'
  | 'recordDate'
  | 'paymentDate'
  | 'perShare'
  | 'gross'
  | 'tax'
  | 'amount'
  | 'payoutKind'
  | 'netAmount';

export type FieldErrors = Readonly<Partial<Record<EntryField, string>>>;

export type Built<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly errors: FieldErrors };

/** Qual campo da tela cada chave do corpo alimenta. */
const FIELD_OF_KEY: Readonly<Record<string, EntryField>> = {
  asset_id: 'asset',
  asset: 'asset',
  trade_date: 'date',
  settlement_date: 'settlement',
  quantity: 'quantity',
  unit_price: 'price',
  fees: 'fees',
  tax_withheld: 'tax',
  portfolio_id: 'portfolio',
  institution_id: 'institution',
  note: 'note',
  record_date: 'recordDate',
  payment_date: 'paymentDate',
  amount_per_share: 'perShare',
  gross_amount: 'gross',
  amount: 'amount',
  payout_kind: 'payoutKind',
  net_amount: 'netAmount',
};

type Issue = { readonly path: readonly PropertyKey[]; readonly message: string };

/**
 * Os erros do schema, no campo de cada um. O primeiro de cada campo vence: duas
 * mensagens no mesmo campo são ruído, e a segunda aparece depois que a primeira
 * for corrigida. `offset` pula o `body` que os schemas de rota põem na frente.
 */
export const issuesToErrors = (issues: readonly Issue[], offset = 1): FieldErrors => {
  const errors: Partial<Record<EntryField, string>> = {};

  for (const issue of issues) {
    const key = issue.path[offset];
    const field = typeof key === 'string' ? FIELD_OF_KEY[key] : undefined;
    if (field !== undefined && errors[field] === undefined) errors[field] = issue.message;
  }

  return errors;
};

/** O erro da `api` que tem campo próprio na tela, em vez de ficar solto no rodapé. */
export const fieldOfApiMessage = (message: string): EntryField | null => {
  const text = message.toLowerCase();

  if (text.includes('quantidade suficiente')) return 'quantity';
  if (text.includes('liquidação')) return 'settlement';
  if (text.includes('data-com')) return 'recordDate';
  if (text.includes('pagamento não pode')) return 'paymentDate';
  if (text.includes('arquivada')) return 'portfolio';
  if (text.includes('instituição')) return 'institution';
  return null;
};

/* -------------------------------------------------------------------------- */
/* Leitura do que foi digitado                                                */

type Read = { readonly value: string | null; readonly error: string | null };

const MISSING: Read = { value: null, error: null };

/**
 * Quantidade em pt-BR. `1.000` é mil, e não um: quem digita quantidade com
 * ponto está agrupando milhar — ninguém compra "1,000 ação" —, e lê-lo como
 * decimal compraria um milésimo do que a pessoa quis. A exceção é a fração
 * evidente (`0.225`), que não tem um a três dígitos antes do ponto e tem zero
 * à esquerda. O preview mostra a quantidade antes → depois, e é ele quem pega
 * o que esta regra deixar passar.
 */
export const parseQuantityInput = (typed: string): string | null => {
  const trimmed = typed.trim();

  if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(trimmed)) {
    return parseAmountInput(trimmed.replaceAll('.', ''));
  }

  return parseAmountInput(trimmed);
};

const read = (
  typed: string,
  options: {
    readonly required: boolean;
    readonly missing: string;
    readonly invalid: string;
    readonly parse?: (typed: string) => string | null;
  },
): Read => {
  if (typed.trim() === '') {
    return options.required ? { value: null, error: options.missing } : MISSING;
  }

  const value = (options.parse ?? parseAmountInput)(typed);
  return value === null
    ? { value: null, error: options.invalid }
    : { value, error: null };
};

const NOT_A_NUMBER = 'Informe um valor como 36,84.';

const collect = (
  errors: Partial<Record<EntryField, string>>,
  field: EntryField,
  result: Read,
): string | null => {
  if (result.error !== null) errors[field] = result.error;
  return result.value;
};

const requireDate = (
  errors: Partial<Record<EntryField, string>>,
  field: EntryField,
  value: string,
): string | null => {
  if (value.trim() === '') {
    errors[field] = 'Informe a data.';
    return null;
  }
  return value;
};

const requireId = (
  errors: Partial<Record<EntryField, string>>,
  field: EntryField,
  value: string | null,
  message: string,
): string | null => {
  if (value === null || value === '') {
    errors[field] = message;
    return null;
  }
  return value;
};

/* -------------------------------------------------------------------------- */
/* Compra e venda                                                             */

export type TradeKind = 'buy' | 'sell';

export type TradeForm = {
  readonly assetId: string | null;
  readonly date: string;
  /** Vazio deixa a `api` sugerir pelo tipo do ativo, em dia útil. */
  readonly settlement: string;
  readonly quantity: string;
  readonly price: string;
  /** Vazio deixa a `api` sugerir pela regra da instituição. */
  readonly fees: string;
  readonly portfolioId: string | null;
  readonly institutionId: string | null;
  readonly note: string;
};

export const buildTradeBody = (
  kind: TradeKind,
  form: TradeForm,
): Built<CreateTransactionBody> => {
  const errors: Partial<Record<EntryField, string>> = {};

  const assetId = requireId(errors, 'asset', form.assetId, 'Escolha o ativo.');
  const portfolioId = requireId(
    errors,
    'portfolio',
    form.portfolioId,
    'Escolha a carteira.',
  );
  const institutionId = requireId(
    errors,
    'institution',
    form.institutionId,
    'Escolha a instituição.',
  );
  const date = requireDate(errors, 'date', form.date);

  const quantity = collect(
    errors,
    'quantity',
    read(form.quantity, {
      required: true,
      missing: 'Informe a quantidade.',
      invalid: 'Informe uma quantidade como 100.',
      parse: parseQuantityInput,
    }),
  );
  const price = collect(
    errors,
    'price',
    read(form.price, {
      required: true,
      missing: 'Informe o preço.',
      invalid: NOT_A_NUMBER,
    }),
  );
  const fees = collect(
    errors,
    'fees',
    read(form.fees, { required: false, missing: '', invalid: NOT_A_NUMBER }),
  );

  if (
    assetId === null ||
    portfolioId === null ||
    institutionId === null ||
    date === null ||
    quantity === null ||
    price === null ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }

  const body = {
    kind,
    portfolio_id: portfolioId,
    institution_id: institutionId,
    asset_id: assetId,
    trade_date: date,
    quantity,
    unit_price: price,
    ...(form.settlement === '' ? {} : { settlement_date: form.settlement }),
    ...(fees === null ? {} : { fees }),
    ...(form.note.trim() === '' ? {} : { note: form.note.trim() }),
  };

  return validated(createTransactionSchema.safeParse({ body }), 1);
};

type Parsed<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: { readonly issues: readonly Issue[] } };

/** O corpo que o schema aceitou, ou os erros dele no campo de cada um. */
const validated = <T extends { readonly body: unknown }>(
  parsed: Parsed<T>,
  offset: number,
): Built<T['body']> =>
  parsed.success
    ? { ok: true, body: parsed.data.body }
    : { ok: false, errors: issuesToErrors(parsed.error.issues, offset) };

/* -------------------------------------------------------------------------- */
/* Aporte e resgate                                                           */

export type CashKind = 'deposit' | 'withdrawal';

export type CashForm = {
  readonly portfolioId: string | null;
  readonly institutionId: string | null;
  readonly date: string;
  readonly amount: string;
  readonly note: string;
};

type CashRead = {
  readonly errors: Partial<Record<EntryField, string>>;
  readonly portfolioId: string | null;
  readonly institutionId: string | null;
  readonly date: string | null;
  readonly amount: string | null;
};

const readCash = (form: CashForm): CashRead => {
  const errors: Partial<Record<EntryField, string>> = {};

  return {
    portfolioId: requireId(errors, 'portfolio', form.portfolioId, 'Escolha a carteira.'),
    institutionId: requireId(
      errors,
      'institution',
      form.institutionId,
      'Escolha a instituição.',
    ),
    date: requireDate(errors, 'date', form.date),
    amount: collect(
      errors,
      'amount',
      read(form.amount, {
        required: true,
        missing: 'Informe o valor.',
        invalid: NOT_A_NUMBER,
      }),
    ),
    errors,
  };
};

export const buildCashBody = (
  kind: CashKind,
  form: CashForm,
): Built<CreateCashMovementBody> => {
  const parts = readCash(form);
  const errors = parts.errors;

  if (
    parts.portfolioId === null ||
    parts.institutionId === null ||
    parts.date === null ||
    parts.amount === null ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }

  const body = {
    kind,
    portfolio_id: parts.portfolioId,
    institution_id: parts.institutionId,
    trade_date: parts.date,
    amount: parts.amount,
    ...(form.note.trim() === '' ? {} : { note: form.note.trim() }),
  };

  return validated(createCashMovementSchema.safeParse({ body }), 1);
};

/**
 * O preview do aporte é o do lançamento de caixa: o caixa vale um real por real,
 * então a quantidade é o próprio valor.
 */
export const buildCashPreviewBody = (
  kind: CashKind,
  form: CashForm,
): Built<CreateTransactionBody> | null => {
  const parts = readCash(form);

  if (
    parts.portfolioId === null ||
    parts.institutionId === null ||
    parts.date === null ||
    parts.amount === null ||
    Object.keys(parts.errors).length > 0
  ) {
    return { ok: false, errors: parts.errors };
  }

  return validated(
    createTransactionSchema.safeParse({
      body: {
        kind,
        portfolio_id: parts.portfolioId,
        institution_id: parts.institutionId,
        trade_date: parts.date,
        quantity: parts.amount,
        unit_price: '1',
      },
    }),
    1,
  );
};

/* -------------------------------------------------------------------------- */
/* Provento                                                                   */

export type PayoutEntryMode = 'per_share' | 'gross';

export type PayoutForm = {
  readonly assetId: string | null;
  readonly payoutKind: PayoutKind;
  readonly recordDate: string;
  readonly paymentDate: string;
  readonly mode: PayoutEntryMode;
  /** O valor por ação ou o bruto, conforme `mode`. */
  readonly amount: string;
  /** Vazio deixa a `api` calcular: 15% no JCP, zero nos demais. */
  readonly tax: string;
  readonly portfolioId: string | null;
  readonly institutionId: string | null;
  /** Marcado, o provento entra como dinheiro recebido; senão, "a receber". */
  readonly received: boolean;
  readonly note: string;
};

export const buildPayoutBody = (form: PayoutForm): Built<CreatePayoutBody> => {
  const errors: Partial<Record<EntryField, string>> = {};

  const assetId = requireId(errors, 'asset', form.assetId, 'Escolha o ativo.');
  const portfolioId = requireId(
    errors,
    'portfolio',
    form.portfolioId,
    'Escolha a carteira.',
  );
  const institutionId = requireId(
    errors,
    'institution',
    form.institutionId,
    'Escolha a instituição.',
  );
  const recordDate = requireDate(errors, 'recordDate', form.recordDate);
  const paymentDate = requireDate(errors, 'paymentDate', form.paymentDate);

  const field: EntryField = form.mode === 'per_share' ? 'perShare' : 'gross';
  const amount = collect(
    errors,
    field,
    read(form.amount, {
      required: true,
      missing: 'Informe o valor.',
      invalid: NOT_A_NUMBER,
    }),
  );
  const tax = collect(
    errors,
    'tax',
    read(form.tax, { required: false, missing: '', invalid: NOT_A_NUMBER }),
  );

  if (
    assetId === null ||
    portfolioId === null ||
    institutionId === null ||
    recordDate === null ||
    paymentDate === null ||
    amount === null ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }

  const body = {
    portfolio_id: portfolioId,
    institution_id: institutionId,
    asset_id: assetId,
    payout_kind: form.payoutKind,
    record_date: recordDate,
    payment_date: paymentDate,
    ...(form.mode === 'per_share'
      ? { amount_per_share: amount }
      : { gross_amount: amount }),
    ...(tax === null ? {} : { tax_withheld: tax }),
    confirmed: form.received,
    ...(form.note.trim() === '' ? {} : { note: form.note.trim() }),
  };

  return validated(createPayoutSchema.safeParse({ body }), 1);
};

/* -------------------------------------------------------------------------- */
/* Editar lançamento                                                          */

export type EditForm = {
  readonly date: string;
  readonly settlement: string;
  readonly quantity: string;
  readonly price: string;
  readonly fees: string;
  readonly tax: string;
  readonly portfolioId: string;
  readonly institutionId: string;
  readonly note: string;
};

/**
 * O decimal como o campo o mostra: sem milhar e sem zeros que sobraram do
 * `NUMERIC(20,8)`. `500.00000000` vira `500` e `31.04000000` vira `31,04`. O
 * ponto de milhar fica de fora de propósito — `1.000` num campo de quantidade
 * é exatamente a ambiguidade que `parseQuantityInput` precisa decidir.
 */
export const inputValue = (value: string | null): string => {
  if (value === null) return '';

  const parts = parseDecimal(value);
  if (parts === null) return '';

  const fraction = parts.fraction.replace(/0+$/, '');
  const body = fraction === '' ? parts.integer : `${parts.integer},${fraction}`;
  return parts.negative && body !== '0' ? `-${body}` : body;
};

export const editFormOf = (transaction: TransactionResource): EditForm => ({
  date: transaction.trade_date,
  settlement: transaction.settlement_date,
  quantity: inputValue(transaction.quantity),
  price: inputValue(transaction.unit_price),
  fees: inputValue(transaction.fees),
  tax: inputValue(transaction.tax_withheld),
  portfolioId: transaction.portfolio_id,
  institutionId: transaction.institution_id,
  note: transaction.note ?? '',
});

export type BuiltEdit =
  | {
      readonly ok: true;
      readonly body: UpdateTransactionBody;
      /** O que mudou: é o que a tela destaca, e o que decide se há o que salvar. */
      readonly changed: readonly EntryField[];
    }
  | { readonly ok: false; readonly errors: FieldErrors };

const sameDecimal = (typed: string, original: string | null): boolean => {
  const value = parseAmountInput(typed);
  return value !== null && original !== null && compareDecimal(value, original) === 0;
};

/**
 * Só o que mudou vai no corpo: a edição é parcial, e mandar o que não mudou
 * seria pedir à `api` para regravar — e recalcular — um valor igual.
 */
export const buildUpdateBody = (
  original: TransactionResource,
  form: EditForm,
  transactionId: string,
): BuiltEdit => {
  const errors: Partial<Record<EntryField, string>> = {};
  const changed: EntryField[] = [];
  const body: Record<string, string> = {};

  const text = (field: EntryField, key: string, now: string, was: string): void => {
    if (now !== was) {
      body[key] = now;
      changed.push(field);
    }
  };

  const decimal = (
    field: EntryField,
    key: string,
    typed: string,
    was: string | null,
    options: {
      readonly required: boolean;
      readonly missing: string;
      readonly invalid: string;
      readonly parse?: (typed: string) => string | null;
    },
  ): void => {
    const result = read(typed, options);
    if (result.error !== null) errors[field] = result.error;
    if (result.value === null) {
      // Taxa e IR vazios na edição significam "zerar", e não "não mexer".
      if (
        !options.required &&
        result.error === null &&
        was !== null &&
        !sameDecimal('0', was)
      ) {
        body[key] = '0';
        changed.push(field);
      }
      return;
    }
    if (!sameDecimal(result.value, was)) {
      body[key] = result.value;
      changed.push(field);
    }
  };

  if (form.date.trim() === '') errors.date = 'Informe a data.';
  else text('date', 'trade_date', form.date, original.trade_date);

  if (form.settlement.trim() === '') errors.settlement = 'Informe a liquidação.';
  else text('settlement', 'settlement_date', form.settlement, original.settlement_date);

  decimal('quantity', 'quantity', form.quantity, original.quantity, {
    required: true,
    missing: 'Informe a quantidade.',
    invalid: 'Informe uma quantidade como 100.',
    parse: parseQuantityInput,
  });
  decimal('price', 'unit_price', form.price, original.unit_price, {
    required: true,
    missing: 'Informe o preço.',
    invalid: NOT_A_NUMBER,
  });
  decimal('fees', 'fees', form.fees, original.fees, {
    required: false,
    missing: '',
    invalid: NOT_A_NUMBER,
  });
  if (original.kind === 'payout') {
    decimal('tax', 'tax_withheld', form.tax, original.tax_withheld, {
      required: false,
      missing: '',
      invalid: NOT_A_NUMBER,
    });
  }

  text('portfolio', 'portfolio_id', form.portfolioId, original.portfolio_id);
  text('institution', 'institution_id', form.institutionId, original.institution_id);
  text('note', 'note', form.note.trim(), (original.note ?? '').trim());

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parsed = updateTransactionSchema.safeParse({
    params: { transaction_id: transactionId },
    body,
  });

  return parsed.success
    ? { ok: true, body: parsed.data.body, changed }
    : { ok: false, errors: issuesToErrors(parsed.error.issues, 1) };
};

/** Evento corporativo não se edita aqui. */
export const isEditable = (transaction: TransactionResource): boolean =>
  transaction.kind !== 'corporate_event';

/* -------------------------------------------------------------------------- */
/* Confirmar recebimento                                                      */

export type ConfirmForm = { readonly netAmount: string; readonly note: string };

export const buildConfirmBody = (form: ConfirmForm): Built<ConfirmPayoutBody> => {
  const errors: Partial<Record<EntryField, string>> = {};

  const netAmount = collect(
    errors,
    'netAmount',
    read(form.netAmount, {
      required: true,
      missing: 'Informe o valor líquido recebido.',
      invalid: NOT_A_NUMBER,
    }),
  );

  if (netAmount === null || Object.keys(errors).length > 0) return { ok: false, errors };

  return validated(
    confirmPayoutSchema.safeParse({
      params: { transaction_id: '00000000-0000-4000-8000-000000000000' },
      body: {
        net_amount: netAmount,
        ...(form.note.trim() === '' ? {} : { note: form.note.trim() }),
      },
    }),
    1,
  );
};

/* -------------------------------------------------------------------------- */
/* O efeito, em linhas                                                        */

export type EffectUnit = 'quantity' | 'money' | 'percent' | 'signed_money';

export type EffectRow =
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'pair';
      readonly unit: EffectUnit;
      readonly before: string | null;
      readonly after: string;
      /** Antes e depois iguais: a tela diz "sem mudança" em vez de repetir o número. */
      readonly unchanged: boolean;
    }
  | {
      readonly id: string;
      readonly label: string;
      readonly kind: 'allocation';
      readonly currentBefore: string;
      readonly currentAfter: string;
      readonly target: string | null;
      /** Em pontos percentuais; nulo quando a classe não tem alvo. */
      readonly deviationAfter: string | null;
    };

const pair = (
  id: string,
  label: string,
  unit: EffectUnit,
  values: { readonly before: string | null; readonly after: string },
): EffectRow => ({
  id,
  label,
  kind: 'pair',
  unit,
  before: values.before,
  after: values.after,
  unchanged: values.before !== null && compareDecimal(values.before, values.after) === 0,
});

export type EffectKind = 'buy' | 'sell' | 'deposit' | 'withdrawal' | 'payout';

/**
 * As linhas do "efeito na posição", na ordem da prancha 13. Compra e venda
 * mostram a posição inteira; aporte e resgate mostram só o caixa e o custo da
 * carteira, porque o caixa é o ativo e não há preço médio a comentar.
 */
export const effectRows = (
  kind: EffectKind,
  preview: TransactionPreviewResource,
  options: { readonly assetLabel?: string } = {},
): readonly EffectRow[] => {
  const asset = options.assetLabel === undefined ? '' : ` ${options.assetLabel}`;

  if (kind === 'deposit' || kind === 'withdrawal') {
    return [
      pair('cash', 'Caixa na instituição', 'money', preview.cash),
      pair('portfolio_cost', 'Custo da carteira', 'money', preview.portfolio_cost_basis),
    ];
  }

  if (kind === 'payout') {
    return [pair('cash', 'Caixa na instituição', 'money', preview.cash)];
  }

  const rows: EffectRow[] = [
    pair('quantity', `Quantidade${asset}`, 'quantity', preview.position.quantity),
    pair('avg_price', 'Preço médio', 'money', preview.position.avg_price),
    pair('cost_basis', 'Custo da posição', 'money', preview.position.cost_basis),
    pair('weight', '% da carteira', 'percent', preview.position.weight_pct),
  ];

  const allocation = preview.allocation;
  if (allocation !== null) {
    rows.push({
      id: 'allocation',
      label: `${allocation.category_name ?? 'Classe'} × alvo da carteira`,
      kind: 'allocation',
      currentBefore: allocation.current_pct.before,
      currentAfter: allocation.current_pct.after,
      target: allocation.target_pct,
      deviationAfter: allocation.deviation_pp?.after ?? null,
    });
  }

  rows.push(
    pair('portfolio_cost', 'Custo da carteira', 'money', preview.portfolio_cost_basis),
  );

  if (kind === 'sell' && preview.realized_result !== null) {
    rows.push(
      pair('realized', 'Resultado realizado', 'signed_money', {
        before: null,
        after: preview.realized_result,
      }),
    );
  }

  return rows;
};

/**
 * O total da operação como a prancha o escreve: valor absoluto, sem o sinal de
 * saída de caixa. Tirar o `-` é formatação, não aritmética — o número é o que a
 * `api` calculou.
 */
export const operationTotal = (preview: TransactionPreviewResource): string =>
  preview.net_amount.replace(/^-/, '');

export const TOTAL_LABEL: Readonly<Record<EffectKind, string>> = {
  buy: 'Total da operação',
  sell: 'Total recebido',
  deposit: 'Valor do aporte',
  withdrawal: 'Valor do resgate',
  payout: 'Líquido do provento',
};

/* -------------------------------------------------------------------------- */
/* Tipos de lançamento da janela                                              */

export type EntryTab =
  'buy' | 'sell' | 'payout' | 'deposit' | 'withdrawal' | 'event';

export const ENTRY_TABS: readonly {
  readonly id: EntryTab;
  readonly label: string;
  /** O motivo, quando a aba aparece mas ainda não pode ser usada. */
  readonly unavailable?: string;
}[] = [
  { id: 'buy', label: 'Compra' },
  { id: 'sell', label: 'Venda' },
  { id: 'payout', label: 'Provento' },
  { id: 'deposit', label: 'Aporte' },
  { id: 'withdrawal', label: 'Resgate' },
  {
    id: 'event',
    label: 'Evento',
    unavailable: 'Evento corporativo ainda não tem preview na api',
  },
];

/**
 * "Duplicar": abre um lançamento novo já com o ativo, a carteira e os números
 * do que se duplica — a data volta a ser hoje. Só compra e venda carregam os
 * números; as demais abas abrem no tipo certo, no mesmo ativo e carteira. Evento
 * não se duplica: sem aba que o lance, a ação não existe.
 */
export type DuplicableRow = {
  readonly kind: string;
  readonly asset_id: string | null;
  readonly ticker: string | null;
  readonly asset_name: string | null;
  readonly portfolio_id: string;
  readonly quantity: string;
  readonly unit_price: string;
  readonly fees: string;
  readonly note: string | null;
};

export type DuplicateRequest = {
  readonly tab: EntryTab;
  readonly asset: {
    readonly id: string;
    readonly label: string;
    readonly name: string | null;
    readonly held: null;
  } | null;
  readonly portfolioId: string;
  readonly seed?: {
    readonly quantity: string;
    readonly price: string;
    readonly fees: string;
    readonly note: string;
  };
};

const DUPLICABLE: readonly string[] = ['buy', 'sell', 'payout', 'deposit', 'withdrawal'];

export const duplicateRequest = (row: DuplicableRow): DuplicateRequest | null => {
  if (!DUPLICABLE.includes(row.kind)) return null;

  const asset =
    row.asset_id === null
      ? null
      : {
          id: row.asset_id,
          label: row.ticker ?? row.asset_name ?? '',
          name: row.asset_name,
          held: null,
        };

  return {
    tab: row.kind as EntryTab,
    asset,
    portfolioId: row.portfolio_id,
    ...(row.kind === 'buy' || row.kind === 'sell'
      ? {
          seed: {
            quantity: inputValue(row.quantity),
            price: inputValue(row.unit_price),
            fees: inputValue(row.fees),
            note: row.note ?? '',
          },
        }
      : {}),
  };
};

/** Provento a receber: o que a tela de Próximos eventos oferece confirmar. */
export const isPendingPayout = (transaction: TransactionResource): boolean =>
  transaction.kind === 'payout' && transaction.confirmed_at === null;

/** A chave que identifica uma tentativa de salvar: o clique duplo é um pedido só. */
export const newAttemptKey = (): string => globalThis.crypto.randomUUID();

/* -------------------------------------------------------------------------- */
/* O que o modal sabe antes de abrir                                          */

export type EntryReference = {
  readonly portfolios: readonly { readonly id: string; readonly name: string }[];
  readonly institutions: readonly { readonly id: string; readonly name: string }[];
};

export const referenceOf = (
  settings: Settings,
  institutions: readonly { readonly id: string; readonly name: string }[],
): EntryReference => ({
  portfolios: settings.portfolios.map(({ id, name }) => ({ id, name })),
  institutions: institutions.map(({ id, name }) => ({ id, name })),
});

/** A data de hoje no relógio de quem digita — não em UTC, que às 22h já é amanhã. */
export const todayDateOnly = (now: Date = new Date()): string =>
  [
    String(now.getFullYear()).padStart(4, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

/**
 * A instituição que o formulário abre marcada: a última que a pessoa usou, se
 * ela ainda existir, e a primeira da lista quando não. Quem lança toda semana na
 * mesma corretora não deveria escolhê-la toda vez.
 */
export const pickInstitution = (
  reference: EntryReference,
  remembered: string | null,
): string | null =>
  reference.institutions.find((institution) => institution.id === remembered)?.id ??
  reference.institutions[0]?.id ??
  null;

/** A carteira do escopo atual, ou a primeira se ela não estiver na lista. */
export const pickPortfolio = (
  reference: EntryReference,
  scopePortfolioId: string | null,
): string | null =>
  reference.portfolios.find((portfolio) => portfolio.id === scopePortfolioId)?.id ??
  reference.portfolios[0]?.id ??
  null;
