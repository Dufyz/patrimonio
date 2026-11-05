/**
 * O modelo de domínio de Finanças.
 *
 * Todo valor monetário é uma string decimal (`"1234.50"`), exatamente como o
 * `NUMERIC(18,2)` chega do banco e como trafega no JSON: nenhum `number` toca
 * dinheiro. Datas de negócio são `YYYY-MM-DD` e meses são `AAAA-MM`.
 *
 * O cálculo mora em `@patrimonio/calc`; aqui há só os tipos e os enums.
 */

export const FIN_KINDS = ['receita', 'despesa'] as const;
export type FinKind = (typeof FIN_KINDS)[number];

export const FIN_ACCOUNT_TYPES = [
  'corrente',
  'poupanca',
  'carteira',
] as const;
export type FinAccountType = (typeof FIN_ACCOUNT_TYPES)[number];

export const FIN_SOURCE_TYPES = ['conta', 'cartao'] as const;
export type FinSourceType = (typeof FIN_SOURCE_TYPES)[number];

/** RN-02: previsto ou lançado. Só o lançado conta em saldos, totais e categorias. */
export const FIN_ENTRY_STATUSES = ['prevista', 'lancada'] as const;
export type FinEntryStatus = (typeof FIN_ENTRY_STATUSES)[number];

export const FIN_RECURRING_MODES = ['manual', 'automatico'] as const;
export type FinRecurringMode = (typeof FIN_RECURRING_MODES)[number];

export const FIN_MOVEMENT_KINDS = [
  'transferencia_entrada',
  'transferencia_saida',
  'ajuste',
] as const;
export type FinMovementKind = (typeof FIN_MOVEMENT_KINDS)[number];

export const FIN_CARD_ITEM_KINDS = ['compra', 'credito', 'encargo'] as const;
export type FinCardItemKind = (typeof FIN_CARD_ITEM_KINDS)[number];

export const FIN_CREDIT_SUBTYPES = [
  'devolucao',
  'estorno',
  'desconto',
  'cashback',
] as const;
export const FIN_CHARGE_SUBTYPES = ['juros', 'multa', 'iof', 'anuidade'] as const;
export type FinCardItemSubtype =
  (typeof FIN_CREDIT_SUBTYPES)[number] | (typeof FIN_CHARGE_SUBTYPES)[number];

export type FinCategory = {
  readonly id: string;
  readonly name: string;
  readonly kind: FinKind;
  /** Identificador da paleta (`violet`), nunca um hexadecimal. */
  readonly color: string;
  readonly archived: boolean;
  readonly version: number;
};

export type FinAccount = {
  readonly id: string;
  readonly name: string;
  readonly type: FinAccountType;
  readonly institution: string | null;
  /** Descrição do papel, em frase: "Recebe as receitas e paga as despesas". */
  readonly role: string;
  readonly role_tag: string | null;
  readonly opening_amount: string;
  /** Movimentações anteriores a esta data não entram no saldo. */
  readonly opening_date: string;
  readonly archived: boolean;
  readonly version: number;
};

export type FinCard = {
  readonly id: string;
  readonly name: string;
  readonly last4: string;
  readonly pay_account_id: string;
  readonly limit_amount: string;
  readonly closing_day: number;
  readonly due_day: number;
  readonly archived: boolean;
  readonly version: number;
};

export type FinSource = { readonly type: FinSourceType; readonly id: string };

export type FinRecurring = {
  readonly id: string;
  readonly name: string;
  readonly kind: FinKind;
  readonly category_id: string;
  readonly source: FinSource;
  readonly second_source: FinSource | null;
  /** Divisão: quanto a primeira origem cobre; a segunda paga o resto (RN-20, RN-21). */
  readonly covers_up_to: string | null;
  readonly day: number;
  readonly mode: FinRecurringMode;
  readonly amount: string;
  readonly active: boolean;
  readonly version: number;
};

/** Uma origem de pagamento e a parte do valor que ela cobre. */
export type FinPayment = {
  readonly source_type: FinSourceType;
  readonly source_id: string;
  readonly amount: string;
  /** Parte de cartão: a fatura (`AAAA-MM`) em que caiu, gravada no lançamento. */
  readonly invoice_month: string | null;
};

export type FinInstallment = {
  readonly group_id: string;
  readonly no: number;
  readonly total: number;
  /** A data da compra original, que a fatura exibe em todas as parcelas. */
  readonly origin: string;
};

export type FinEntry = {
  readonly id: string;
  readonly kind: FinKind;
  readonly description: string;
  readonly date: string;
  readonly category_id: string;
  /** Sempre positivo; o sinal vem do tipo. */
  readonly amount: string;
  readonly status: FinEntryStatus;
  readonly recurring_id: string | null;
  readonly installment: FinInstallment | null;
  readonly note: string | null;
  readonly payments: readonly FinPayment[];
  readonly version: number;
};

/** Movimentação fora de Lançamentos: nunca é receita nem despesa (RN-33). `amount` leva o sinal. */
export type FinMovement = {
  readonly id: string;
  readonly date: string;
  readonly account_id: string;
  readonly kind: FinMovementKind;
  readonly amount: string;
  readonly description: string;
  readonly note: string | null;
  readonly transfer_id: string | null;
};

/** Item que só existe na fatura (RN-46). `amount` é sempre positivo; o tipo diz se soma ou abate. */
export type FinCardItem = {
  readonly id: string;
  readonly card_id: string;
  readonly kind: FinCardItemKind;
  readonly subtype: FinCardItemSubtype | null;
  readonly purchase_date: string;
  readonly invoice_month: string;
  readonly description: string;
  readonly category_id: string | null;
  readonly amount: string;
  readonly installment: FinInstallment | null;
  /** Crédito que estorna uma compra: o id do lançamento ou item estornado. */
  readonly reverses_id: string | null;
  readonly version: number;
};

/** Pagamento (possivelmente parcial) de uma fatura (RN-50). */
export type FinInvoicePayment = {
  readonly id: string;
  readonly card_id: string;
  readonly invoice_month: string;
  readonly account_id: string;
  readonly date: string;
  readonly amount: string;
  /** `false`: anterior ao período acompanhado, já contido no saldo inicial. */
  readonly posted: boolean;
};

/** Mês em que o lançamento de um recorrente foi excluído: o previsto não é regenerado (RN-06). */
export type FinSkip = { readonly recurring_id: string; readonly month: string };

/** Tudo que Finanças guarda, numa foto. O motor de cálculo trabalha sobre ela. */
export type FinSnapshot = {
  readonly categories: readonly FinCategory[];
  readonly accounts: readonly FinAccount[];
  readonly cards: readonly FinCard[];
  readonly recurrings: readonly FinRecurring[];
  readonly skips: readonly FinSkip[];
  readonly entries: readonly FinEntry[];
  readonly movements: readonly FinMovement[];
  readonly card_items: readonly FinCardItem[];
  readonly invoice_payments: readonly FinInvoicePayment[];
};

export const emptySnapshot = (): FinSnapshot => ({
  categories: [],
  accounts: [],
  cards: [],
  recurrings: [],
  skips: [],
  entries: [],
  movements: [],
  card_items: [],
  invoice_payments: [],
});
