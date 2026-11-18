import type { EffectResource, PreviewResponse } from '../api/ledger_write.js';
import type { EffectRow } from '../finance/domain/effects.js';
import type { PickedAsset } from '../views/entry/asset_picker.js';
import { compareDecimal, parseDecimal } from './decimal.js';
import type { EffectRow as PairRow } from './entry.js';

/**
 * LAN-09 · O rascunho do modal "Nova movimentação" e o que dele vira pedido.
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

/** A linha de contexto sob o título do modal, uma por tipo (prancha 07). */
export const MODAL_KIND_SUBTITLE: Readonly<Record<ModalKind, string>> = {
  RECEITA: 'Receita · entra em uma conta',
  DESPESA: 'Despesa · sai de uma conta ou cartão',
  TRANSFERENCIA: 'Transferência · conta → conta',
  PAGAMENTO_FATURA: 'Pagamento de fatura · conta → cartão',
  APORTE: 'Aporte · conta → carteira, com ativo, quantidade e preço',
  RESGATE: 'Resgate · carteira → conta',
  PROVENTO: 'Provento · dividendo, JCP ou juros',
  EVENTO: 'Evento · custódia, desdobramento',
};

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
  /** Aporte lançado a partir de um previsto: o recorrente que sai do mês (LAN-06). */
  readonly recurringId: string;
  /** Receita e despesa: ainda não aconteceu (status previsto). */
  readonly planned: boolean;
  /** Receita e despesa: anotações livres, além da descrição. */
  readonly note: string;
  /** Receita e despesa: `accountId` é uma conta ou (só despesa) um cartão. */
  readonly sourceType: 'conta' | 'cartao';
  /** Despesa no cartão: número de parcelas, de 1 a 24. */
  readonly installments: string;
  /** Despesa: a segunda origem (`conta:<id>` ou `cartao:<id>`); vazio é não dividir. */
  readonly splitSource: string;
  /** O quanto sai da segunda origem; o resto sai da primeira. */
  readonly splitAmount: string;
  /** Receita e despesa novas: cria também o recorrente do mesmo item. */
  readonly repeat: boolean;
  /** Previsto que ainda não tem data (fica fora de período e de totais). */
  readonly undated: boolean;
};

/** A data guardada no previsto sem data (`UNDATED_DATE` do domínio). */
export const UNDATED_DATE = '9999-12-31';

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
  accountId:
    context.accountId ??
    (context.cardId !== undefined && context.invoice !== true ? context.cardId : ''),
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
  recurringId: '',
  planned: false,
  note: '',
  sourceType:
    context.cardId !== undefined &&
    context.invoice !== true &&
    context.accountId === undefined
      ? 'cartao'
      : 'conta',
  installments: '1',
  splitSource: '',
  splitAmount: '',
  repeat: false,
  undated: false,
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
        // Só despesa sai de cartão; nos demais tipos a origem volta a ser conta.
        ...(kind !== 'DESPESA' && draft.sourceType === 'cartao'
          ? { sourceType: 'conta' as const, accountId: '' }
          : {}),
        installments: '1',
        splitSource: '',
        splitAmount: '',
        repeat: isPlannable(kind) ? draft.repeat : false,
        undated: isPlannable(kind) ? draft.undated : false,
      };

export type DraftErrors = Partial<Record<keyof Draft, string>>;

/** RN-03: lançamento não nasce no futuro; para o futuro, um recorrente. */
export const FUTURE_DATE_MESSAGE =
  'Data futura não é movimentação lançada. Crie um recorrente ou um previsto.';

const positive = (value: string): boolean => {
  const parts = parseDecimal(decimal(value));
  return (
    parts !== null && !parts.negative && !/^0*$/.test(parts.integer + parts.fraction)
  );
};

const nonNegative = (value: string): boolean => {
  const parts = parseDecimal(decimal(value));
  return parts !== null && !parts.negative;
};

/** Receita e despesa podem ser previstas; os demais tipos só nascem lançados. */
export const isPlannable = (kind: ModalKind): boolean =>
  kind === 'RECEITA' || kind === 'DESPESA';

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
  if (draft.undated && isPlannable(draft.kind)) {
    if (draft.sourceType === 'cartao' || draft.splitSource !== '') {
      errors.undated = 'Sem data só sai de uma conta: no cartão a data decide a fatura.';
    }
    if (draft.repeat) errors.undated = 'Recorrente precisa de data: escolha o dia.';
  } else if (draft.date === '') errors.date = 'Informe a data.';
  else if (draft.date > today && !isPlannable(draft.kind)) {
    errors.date = FUTURE_DATE_MESSAGE;
  }
  const amount = parseDecimal(decimal(draft.amount));
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
  if (draft.kind === 'DESPESA') {
    const count = Number(draft.installments);
    if (!Number.isInteger(count) || count < 1 || count > 24) {
      errors.installments = 'De 1 a 24 parcelas.';
    } else if (count > 1 && (draft.sourceType !== 'cartao' || draft.splitSource !== '')) {
      errors.installments = 'Só compra no cartão, de uma origem, é parcelada.';
    }
    if (draft.splitSource !== '') {
      if (draft.splitSource === `${draft.sourceType}:${draft.accountId}`) {
        errors.splitSource = 'A segunda origem precisa ser outra.';
      } else if (!positive(draft.splitAmount)) {
        errors.splitAmount = 'Informe quanto sai da segunda origem.';
      } else if (
        positive(draft.amount) &&
        compareDecimal(decimal(draft.splitAmount), decimal(draft.amount)) >= 0
      ) {
        errors.splitAmount = 'A parte tem de ser menor que o valor total.';
      }
    }
  }
  return errors;
};

/** `conta:<id>` ou `cartao:<id>` → a origem do contrato. */
export const decodeSource = (
  value: string,
): { readonly source_type: 'conta' | 'cartao'; readonly source_id: string } => {
  const [type, id] = value.split(':');
  return { source_type: type === 'cartao' ? 'cartao' : 'conta', source_id: id ?? '' };
};

const centsOf = (value: string): number => {
  const parts = parseDecimal(decimal(value));
  if (parts === null) return 0;
  return Number(parts.integer) * 100 + Number(`${parts.fraction}00`.slice(0, 2));
};

/** As origens do pagamento: uma, ou duas com a parte da segunda (RN-21). */
const paymentsOf = (draft: Draft): readonly Record<string, string>[] => {
  const main = { source_type: draft.sourceType, source_id: draft.accountId };
  if (draft.kind !== 'DESPESA' || draft.splitSource === '') return [main];
  const rest = centsOf(draft.amount) - centsOf(draft.splitAmount);
  return [
    { ...main, amount: (rest / 100).toFixed(2) },
    { ...decodeSource(draft.splitSource), amount: decimal(draft.splitAmount) },
  ];
};

export const isValid = (errors: DraftErrors): boolean => Object.keys(errors).length === 0;

/** `1.500,00` (máscara) ou `1500,5` viram `1500.00`/`1500.5`; `121.10` fica como está. */
const decimal = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
};

export type EntryRequest = {
  readonly path: string;
  readonly body: unknown;
  /** Quando o preview vai a outro endereço ou com outro corpo. */
  readonly preview?: { readonly path: string; readonly body: unknown };
  /** Evento: registrar não aplica; a gravação confirma em seguida. */
  readonly confirmEvent?: true;
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
  ...(draft.recurringId === '' ? {} : { recurring_id: draft.recurringId }),
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
            date: draft.undated ? UNDATED_DATE : draft.date,
            category_id: draft.categoryId,
            amount: decimal(draft.amount),
            payments: paymentsOf(draft),
            ...(draft.kind === 'DESPESA' && Number(draft.installments) > 1
              ? { installments: Number(draft.installments) }
              : {}),
            // A situação vem da data: depois de hoje (ou sem data) é previsto.
            status: draft.planned || draft.undated ? 'prevista' : 'lancada',
            ...(draft.note.trim() === '' ? { note: null } : { note: draft.note.trim() }),
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
const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** `2026-12` → `dez/26`, como as pranchas escrevem o mês. */
const monthLabel = (month: string): string =>
  /^\d{4}-\d{2}$/.test(month)
    ? `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)}/${month.slice(2, 4)}`
    : month;

export const effectRows = (effect: EffectResource): readonly EffectRow[] => [
  ...effect.accounts.map((a) => ({
    label: `Saldo · ${a.name}`,
    before: cents(a.before),
    after: cents(a.after),
  })),
  ...(effect.invoices ?? []).map((i) => ({
    label: `Fatura · ${i.name} · ${monthLabel(i.month)}`,
    before: cents(i.before),
    after: cents(i.after),
  })),
  ...wealthRows(effect),
  ...effect.months.flatMap((m) => [
    {
      label: `Receitas · ${monthLabel(m.month)}`,
      before: cents(m.receitas_before),
      after: cents(m.receitas_after),
    },
    {
      label: `Despesas · ${monthLabel(m.month)}`,
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

/** O corpo de uma receita ou despesa lançada, como o livro o devolve em `entry`. */
export type EditableEntry = {
  readonly kind: string;
  readonly description: string;
  readonly date: string;
  readonly category_id: string;
  readonly amount: string;
  readonly payments: readonly {
    readonly source_type: string;
    readonly source_id: string;
    readonly amount?: string | undefined;
  }[];
  readonly status?: string | undefined;
  readonly note?: string | null | undefined;
};

/** LAN-07 · O rascunho de edição: o tipo e os campos do lançamento que já existe. */
export const draftFromEntry = (today: string, entry: EditableEntry): Draft => {
  const [main, second] = entry.payments;
  const undated = entry.date === UNDATED_DATE;
  return {
    ...newDraft(today, {}, entry.kind === 'receita' ? 'RECEITA' : 'DESPESA'),
    description: entry.description,
    date: undated ? '' : entry.date,
    undated,
    amount: entry.amount.replace('.', ','),
    categoryId: entry.category_id,
    sourceType: main?.source_type === 'cartao' ? 'cartao' : 'conta',
    accountId: main?.source_id ?? '',
    splitSource:
      second === undefined
        ? ''
        : `${second.source_type === 'cartao' ? 'cartao' : 'conta'}:${second.source_id}`,
    splitAmount: second?.amount?.replace('.', ',') ?? '',
    // Editar decide pela data: um previsto vencido salvo como está vira lançado.
    planned: undated || entry.date > today,
    note: entry.note ?? '',
  };
};
