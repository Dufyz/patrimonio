import type { EffectResource, PreviewResponse } from '../api/ledger_write.js';
import type { EffectRow } from '../finance/domain/effects.js';
import type { EffectRow as PairRow } from './entry.js';
import type { PickedAsset } from '../views/entry/asset_picker.js';
import { compareDecimal, parseDecimal } from './decimal.js';

/**
 * LAN-09 · O rascunho do modal "Novo lançamento" e o que dele vira pedido.
 *
 * Os tipos entram à medida que o servidor os grava; hoje, receita e despesa.
 * Trocar de tipo mantém os campos compatíveis (data, valor, conta, descrição) e
 * descarta só a categoria, que é de um tipo.
 */
export const MODAL_KINDS = [
  'RECEITA',
  'DESPESA',
  'TRANSFERENCIA',
  'PAGAMENTO_FATURA',
  'APORTE',
  'RESGATE',
  'PROVENTO',
  'EVENTO',
] as const;
export type ModalKind = (typeof MODAL_KINDS)[number];

export const MODAL_KIND_LABEL: Readonly<Record<ModalKind, string>> = {
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
  TRANSFERENCIA: 'Transferência',
  PAGAMENTO_FATURA: 'Pagamento de fatura',
  APORTE: 'Aporte',
  RESGATE: 'Resgate',
  PROVENTO: 'Provento',
  EVENTO: 'Evento',
};

/** Origem "Fora do app" no aporte e destino "Fora do app" no resgate. */
export const OUTSIDE = 'fora';

export type Draft = {
  readonly kind: ModalKind;
  readonly description: string;
  readonly date: string;
  readonly amount: string;
  readonly accountId: string;
  /** Só transferência: a conta de destino. */
  readonly toAccountId: string;
  /** Só pagamento de fatura: o cartão e o mês da fatura. */
  readonly cardId: string;
  readonly month: string;
  readonly categoryId: string;
  /** Aporte e resgate. */
  readonly portfolioId: string;
  readonly institutionId: string;
  readonly asset: PickedAsset | null;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly fees: string;
  /** Resgate: gerar a despesa ligada (RN-U6). */
  readonly linkExpense: boolean;
  /** Provento: dividendo, JCP, juros; data-com e IR retido. */
  readonly payoutKind: string;
  readonly recordDate: string;
  readonly tax: string;
  /** Evento: desdobramento, grupamento ou bonificação, e o fator. */
  readonly eventKind: string;
  readonly ratioFrom: string;
  readonly ratioTo: string;
};

export type DraftContext = {
  readonly accountId?: string | undefined;
  readonly cardId?: string | undefined;
  readonly portfolioId?: string | undefined;
  readonly assetId?: string | undefined;
  readonly invoice?: boolean | undefined;
};

/** O tipo inicial vem do contexto: fatura → pagamento; ativo → aporte; resto → despesa. */
export const initialKind = (context: DraftContext): ModalKind =>
  context.invoice === true
    ? 'PAGAMENTO_FATURA'
    : context.assetId !== undefined
      ? 'APORTE'
      : 'DESPESA';

export const newDraft = (
  today: string,
  context: DraftContext = {},
  kind: ModalKind = initialKind(context),
): Draft => ({
  kind,
  description: '',
  date: today,
  amount: '',
  accountId: context.accountId ?? '',
  toAccountId: '',
  cardId: context.cardId ?? '',
  month: '',
  categoryId: '',
  portfolioId: context.portfolioId ?? '',
  institutionId: '',
  asset: null,
  quantity: '',
  unitPrice: '',
  fees: '',
  linkExpense: false,
  payoutKind: 'dividend',
  recordDate: '',
  tax: '',
  eventKind: 'split',
  ratioFrom: '1',
  ratioTo: '2',
});

export const switchKind = (draft: Draft, kind: ModalKind): Draft =>
  kind === draft.kind
    ? draft
    : {
        ...draft,
        kind,
        categoryId: '',
        toAccountId: '',
        cardId: '',
        month: '',
        linkExpense: false,
      };

export type DraftErrors = Partial<Record<keyof Draft, string>>;

/** RN-03: lançamento não nasce no futuro; para o futuro, um recorrente. */
export const FUTURE_DATE_MESSAGE =
  'Data futura não é lançamento. Crie um recorrente ou um previsto.';

const positive = (value: string): boolean => {
  const parts = parseDecimal(value.trim().replace(',', '.'));
  return (
    parts !== null && !parts.negative && !/^0*$/.test(parts.integer + parts.fraction)
  );
};

const nonNegative = (value: string): boolean => {
  const parts = parseDecimal(value.trim().replace(',', '.'));
  return parts !== null && !parts.negative;
};

export const isInvestment = (kind: ModalKind): boolean =>
  kind === 'APORTE' || kind === 'RESGATE';

/** Provento e evento: ativo com posição, sem quantidade nem preço digitados. */
export const isAssetEvent = (kind: ModalKind): boolean =>
  kind === 'PROVENTO' || kind === 'EVENTO';

export const PAYOUT_KIND_LABEL: Readonly<Record<string, string>> = {
  dividend: 'Dividendo',
  jcp: 'JCP',
  interest: 'Juros',
  income: 'Rendimento',
};

export const EVENT_KIND_LABEL: Readonly<Record<string, string>> = {
  split: 'Desdobramento',
  reverse_split: 'Grupamento',
  bonus: 'Bonificação',
};

/** LAN-16/17 · Validação de provento e de evento. */
const validateAssetEvent = (draft: Draft): DraftErrors => {
  const errors: DraftErrors = {};
  if (draft.asset === null || draft.asset.id === null) {
    errors.asset = 'Escolha um ativo da lista.';
  }
  if (draft.kind === 'EVENTO') {
    const from = draft.ratioFrom.replace(',', '.');
    const to = draft.ratioTo.replace(',', '.');
    if (!positive(from)) errors.ratioFrom = 'Informe o fator.';
    if (!positive(to)) errors.ratioTo = 'Informe o fator.';
    if (errors.ratioFrom === undefined && errors.ratioTo === undefined) {
      const cmp = compareDecimal(to, from);
      if (draft.eventKind === 'reverse_split' ? cmp >= 0 : cmp <= 0) {
        errors.ratioTo =
          'O fator não combina com o tipo: grupamento reduz a quantidade; desdobramento e bonificação aumentam.';
      }
    }
    if (draft.date === '') errors.date = 'Informe a data.';
    return errors;
  }
  if (draft.portfolioId === '') errors.portfolioId = 'Escolha a carteira.';
  if (draft.institutionId === '') errors.institutionId = 'Escolha a instituição.';
  if (!positive(draft.amount)) errors.amount = 'Informe um valor maior que zero.';
  if (draft.tax.trim() !== '' && !nonNegative(draft.tax)) {
    errors.tax = 'O IR retido não pode ser negativo.';
  }
  if (draft.date === '') errors.date = 'Informe a data.';
  if (draft.accountId === '') errors.accountId = 'Escolha a conta que recebe.';
  return errors;
};

/** LAN-14/15 · Aporte e resgate: carteira, ativo da lista, quantidade, preço, taxas, conta. */
const validateInvestment = (draft: Draft, today: string): DraftErrors => {
  const errors: DraftErrors = {};
  if (draft.portfolioId === '') errors.portfolioId = 'Escolha a carteira.';
  if (draft.institutionId === '') errors.institutionId = 'Escolha a instituição.';
  if (draft.asset === null || draft.asset.id === null) {
    errors.asset = 'Escolha um ativo da lista.';
  }
  if (!positive(draft.quantity)) {
    errors.quantity = 'Informe uma quantidade maior que zero.';
  } else if (
    draft.kind === 'RESGATE' &&
    draft.asset?.held != null &&
    compareDecimal(draft.quantity.replace(',', '.'), draft.asset.held) > 0
  ) {
    errors.quantity = `Você tem ${draft.asset.held}; a quantidade passa da posição.`;
  }
  if (!positive(draft.unitPrice)) errors.unitPrice = 'Informe o preço.';
  if (draft.fees.trim() !== '' && !nonNegative(draft.fees)) {
    errors.fees = 'As taxas não podem ser negativas.';
  }
  if (draft.date === '') errors.date = 'Informe a data.';
  else if (draft.date > today) errors.date = FUTURE_DATE_MESSAGE;
  if (draft.accountId === '') {
    errors.accountId =
      draft.kind === 'APORTE' ? 'Escolha a origem.' : 'Escolha a conta de destino.';
  }
  if (draft.kind === 'RESGATE' && draft.linkExpense) {
    if (draft.accountId === OUTSIDE) {
      errors.accountId = 'Para gerar a despesa ligada, escolha a conta que recebe.';
    }
    if (draft.categoryId === '') errors.categoryId = 'Escolha a categoria da despesa.';
  }
  return errors;
};

export const validateDraft = (draft: Draft, today: string): DraftErrors => {
  if (isInvestment(draft.kind)) return validateInvestment(draft, today);
  if (isAssetEvent(draft.kind)) return validateAssetEvent(draft);
  const errors: DraftErrors = {};
  const transfer = draft.kind === 'TRANSFERENCIA';
  const payment = draft.kind === 'PAGAMENTO_FATURA';
  if (!transfer && !payment && draft.description.trim() === '') {
    errors.description = 'Informe a descrição.';
  }
  if (draft.date === '') errors.date = 'Informe a data.';
  else if (draft.date > today) errors.date = FUTURE_DATE_MESSAGE;
  const amount = parseDecimal(draft.amount.replace(',', '.'));
  if (
    amount === null ||
    amount.negative ||
    /^0*$/.test(amount.integer + amount.fraction)
  ) {
    errors.amount = 'Informe um valor maior que zero.';
  }
  if (draft.accountId === '') {
    errors.accountId = transfer ? 'Escolha a conta de origem.' : 'Escolha a conta.';
  }
  if (transfer) {
    if (draft.toAccountId === '') errors.toAccountId = 'Escolha a conta de destino.';
    else if (draft.toAccountId === draft.accountId) {
      errors.toAccountId = 'Origem e destino precisam ser contas diferentes.';
    }
  } else if (payment) {
    if (draft.cardId === '') errors.cardId = 'Escolha o cartão.';
    else if (draft.month === '') errors.cardId = 'Esse cartão não tem fatura a pagar.';
  } else if (draft.categoryId === '') errors.categoryId = 'Escolha a categoria.';
  return errors;
};

export const isValid = (errors: DraftErrors): boolean => Object.keys(errors).length === 0;

const decimal = (value: string): string => value.trim().replace(',', '.');

export type EntryRequest = {
  readonly path: string;
  readonly body: unknown;
  /** Quando o preview vai a outro endereço ou com outro corpo. */
  readonly preview?: { readonly path: string; readonly body: unknown };
  /** Evento: registrar não aplica; a gravação confirma em seguida. */
  readonly confirmEvent?: true;
};

export type InvoicePaymentBody = {
  readonly account_id: string;
  readonly date: string;
  readonly amount: string;
};

/** Vírgula decimal digitada vira o ponto que o contrato pede. */
const investmentBase = (draft: Draft) => ({
  portfolio_id: draft.portfolioId,
  institution_id: draft.institutionId,
  trade_date: draft.date,
  quantity: decimal(draft.quantity),
  unit_price: decimal(draft.unitPrice),
  ...(draft.fees.trim() === '' ? {} : { fees: decimal(draft.fees) }),
  account_id: draft.accountId === OUTSIDE ? null : draft.accountId,
});

const toAssetEventRequest = (draft: Draft): EntryRequest => {
  if (draft.kind === 'EVENTO') {
    const common = {
      asset_id: draft.asset?.id ?? '',
      record_date: draft.date,
      ratio_from: decimal(draft.ratioFrom),
      ratio_to: decimal(draft.ratioTo),
    };
    return {
      path: '/api/corporate-events',
      body: { ...common, kind: draft.eventKind },
      preview: {
        path: '/api/transactions/preview',
        body: { ...common, kind: 'corporate_event', event_kind: draft.eventKind },
      },
      confirmEvent: true,
    };
  }
  const body = {
    portfolio_id: draft.portfolioId,
    institution_id: draft.institutionId,
    asset_id: draft.asset?.id ?? '',
    payout_kind: draft.payoutKind,
    record_date: draft.recordDate === '' ? draft.date : draft.recordDate,
    payment_date: draft.date,
    gross_amount: decimal(draft.amount),
    ...(draft.tax.trim() === '' ? {} : { tax_withheld: decimal(draft.tax) }),
    account_id: draft.accountId === OUTSIDE ? null : draft.accountId,
  };
  return {
    path: '/api/transactions/payouts',
    body,
    preview: { path: '/api/transactions/payouts/preview', body },
  };
};

export const toRequest = (draft: Draft): EntryRequest =>
  isAssetEvent(draft.kind)
    ? toAssetEventRequest(draft)
    : draft.kind === 'APORTE'
      ? {
          path: '/api/ledger/aportes',
          body: { ...investmentBase(draft), asset_id: draft.asset?.id ?? '' },
        }
      : draft.kind === 'RESGATE'
        ? {
            path: '/api/ledger/resgates',
            body: {
              ...investmentBase(draft),
              asset_id: draft.asset?.id ?? '',
              ...(draft.linkExpense
                ? {
                    linked_expense: {
                      category_id: draft.categoryId,
                      ...(draft.description.trim() === ''
                        ? {}
                        : { description: draft.description.trim() }),
                    },
                  }
                : {}),
            },
          }
        : toFinanceRequest(draft);

const toFinanceRequest = (draft: Draft): EntryRequest =>
  draft.kind === 'PAGAMENTO_FATURA'
    ? {
        path: `/api/finance/cards/${draft.cardId}/invoices/${draft.month}/payments`,
        body: {
          account_id: draft.accountId,
          date: draft.date,
          amount: decimal(draft.amount),
        },
      }
    : draft.kind === 'TRANSFERENCIA'
      ? {
          path: '/api/finance/transfers',
          body: {
            from_account_id: draft.accountId,
            to_account_id: draft.toAccountId,
            amount: decimal(draft.amount),
            date: draft.date,
            note: draft.description.trim() === '' ? null : draft.description.trim(),
          },
        }
      : {
          path: '/api/finance/entries',
          body: {
            kind: draft.kind === 'RECEITA' ? 'receita' : 'despesa',
            description: draft.description.trim(),
            date: draft.date,
            category_id: draft.categoryId,
            amount: decimal(draft.amount),
            payments: [{ source_type: 'conta', source_id: draft.accountId }],
            status: 'lancada',
          },
        };

const cents = (value: string): number => {
  const parts = parseDecimal(value);
  if (parts === null) return 0;
  const frac = `${parts.fraction}00`.slice(0, 2);
  const total = Number(parts.integer) * 100 + Number(frac);
  return parts.negative ? -total : total;
};

/** Em contas, total devido e Livre após faturas: só quando o lançamento os move. */
const wealthRows = (effect: EffectResource): readonly EffectRow[] => {
  const w = effect.wealth;
  if (w === undefined) return [];
  const rows: [string, { before: string; after: string }][] = [
    ['Em contas', w.em_contas],
    ['Total devido', w.total_devido],
    ['Livre após faturas', w.livre],
    ['Falta para as faturas', w.falta],
  ];
  return rows
    .filter(([, v]) => v.before !== v.after)
    .map(([label, v]) => ({ label, before: cents(v.before), after: cents(v.after) }));
};

/** As linhas do bloco "Efeito" a partir do preview do servidor. */
export const effectRows = (effect: EffectResource): readonly EffectRow[] => [
  ...effect.accounts.map((a) => ({
    label: `Saldo · ${a.name}`,
    before: cents(a.before),
    after: cents(a.after),
  })),
  ...(effect.invoices ?? []).map((i) => ({
    label: `Fatura · ${i.name} ${i.month}`,
    before: cents(i.before),
    after: cents(i.after),
  })),
  ...wealthRows(effect),
  ...effect.months.flatMap((m) => [
    {
      label: `Receitas · ${m.month}`,
      before: cents(m.receitas_before),
      after: cents(m.receitas_after),
    },
    {
      label: `Despesas · ${m.month}`,
      before: cents(m.despesas_before),
      after: cents(m.despesas_after),
    },
  ]),
];

const pair = (
  id: string,
  label: string,
  unit: 'quantity' | 'money',
  values: { readonly before: string; readonly after: string },
): PairRow => ({
  id,
  label,
  kind: 'pair',
  unit,
  before: values.before,
  after: values.after,
  unchanged: compareDecimal(values.before, values.after) === 0,
});

/** O bloco "Efeito" de qualquer preview: conta, fatura, mês e — no aporte/resgate — a posição. */
export const previewRows = (
  response: PreviewResponse,
  accountName: (id: string) => string | null,
): readonly (EffectRow | PairRow)[] => [
  ...(response.effect === undefined ? [] : effectRows(response.effect)),
  ...(response.account === null || response.account === undefined
    ? []
    : [
        {
          label: `Saldo · ${accountName(response.account.account_id) ?? 'conta'}`,
          before: cents(response.account.before),
          after: cents(response.account.after),
        },
      ]),
  ...(response.portfolios ?? []).flatMap((p) => [
    pair('quantity', `Quantidade · ${p.portfolio_name}`, 'quantity', p.quantity),
    pair('avg_price', `Preço médio · ${p.portfolio_name}`, 'money', p.avg_price),
    pair('cost_basis', `Custo total · ${p.portfolio_name}`, 'money', p.cost_basis),
  ]),
  ...(response.net_amount === undefined
    ? []
    : [
        pair('gross', 'Valor bruto', 'money', {
          before: '0',
          after: response.gross_amount ?? response.net_amount,
        }),
        pair('net', 'Valor líquido na conta', 'money', {
          before: '0',
          after: response.net_amount,
        }),
      ]),
  ...(response.position === null || response.position === undefined
    ? []
    : [
        pair('quantity', 'Quantidade', 'quantity', response.position.quantity),
        pair('avg_price', 'Preço médio', 'money', response.position.avg_price),
        pair('cost_basis', 'Custo da posição', 'money', response.position.cost_basis),
      ]),
];
