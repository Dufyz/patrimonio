import { Decimal } from 'decimal.js';

/**
 * O preço médio é único por ativo e carteira: não existem lotes individuais no
 * modelo. A consequência é deliberada — a apuração de DARF por lote fica fora do
 * produto, e em troca toda a tela de Posições vira uma linha por ativo.
 *
 * Nenhuma função deste módulo chama `new Date()` nem fala com banco: a sequência
 * de lançamentos entra como parâmetro, e é isso que torna o teste determinístico.
 */
export const LEDGER_KINDS = [
  'buy',
  'sell',
  'payout',
  'deposit',
  'withdrawal',
  'transfer',
  'corporate_event',
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

export type LedgerEntry = {
  readonly id?: string | undefined;
  readonly kind: LedgerKind;
  /** `YYYY-MM-DD`: data de negócio, nunca `Date` com fuso. */
  readonly trade_date: string;
  readonly quantity: string;
  readonly unit_price: string;
  readonly fees: string;
  readonly net_amount: string;
  readonly payout_kind?: string | null | undefined;
  readonly event_ratio_from?: string | null | undefined;
  readonly event_ratio_to?: string | null | undefined;
};

/** Casas por grandeza, iguais às do schema: quantidade e preço 8, reais 2. */
const QUANTITY_DP = 8;
const PRICE_DP = 8;
const MONEY_DP = 2;

export type Position = {
  readonly quantity: string;
  readonly avg_price: string;
  readonly cost_basis: string;
};

export type RealizedSale = {
  readonly entry_id: string | null;
  readonly trade_date: string;
  /** Valor recebido, já líquido das taxas da operação. */
  readonly proceeds: string;
  readonly cost_consumed: string;
  readonly result: string;
};

export type LedgerState = {
  readonly position: Position;
  readonly realized: readonly RealizedSale[];
  readonly realized_total: string;
  /**
   * Uma venda maior do que a posição disponível. O motor não inventa posição
   * negativa: ele zera e marca, e quem planeja recusa o lançamento.
   */
  readonly oversold: boolean;
};

type Internal = {
  quantity: Decimal;
  cost: Decimal;
  realized: RealizedSale[];
  oversold: boolean;
};

const zero = new Decimal(0);

const decimal = (value: string | null | undefined): Decimal =>
  value === null || value === undefined || value === '' ? zero : new Decimal(value);

/**
 * A ordem é cronológica, e o desempate é o id — que é UUID v7, portanto
 * crescente no tempo. É o que faz "aplicar em ordem embaralhada dá o mesmo
 * resultado" valer: a sequência é reconstruída, não assumida.
 *
 * Lançamento sem id é o rascunho que está sendo planejado agora, e ele é o mais
 * novo do dia: vai para o fim. Tratá-lo como id vazio o colocava **antes** de
 * tudo o que já estava gravado naquela data — e vender no mesmo dia da compra
 * era recusado por posição insuficiente, porque a venda era aplicada primeiro.
 */
const DRAFT_LAST = '￿';

export const sortEntries = (entries: readonly LedgerEntry[]): LedgerEntry[] =>
  [...entries].sort((left, right) => {
    if (left.trade_date !== right.trade_date) {
      return left.trade_date < right.trade_date ? -1 : 1;
    }

    const leftId = left.id ?? DRAFT_LAST;
    const rightId = right.id ?? DRAFT_LAST;

    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });

/** Quantidade move para fora quando o dinheiro — ou o ativo — sai da carteira. */
const isOutgoing = (entry: LedgerEntry): boolean =>
  decimal(entry.net_amount).isNegative();

const applyBuy = (state: Internal, entry: LedgerEntry): void => {
  const quantity = decimal(entry.quantity);
  // Taxas entram no custo, não no preço unitário: o preço unitário continua
  // sendo o que foi negociado, e é ele que confere com a nota.
  const cost = quantity.times(decimal(entry.unit_price)).plus(decimal(entry.fees));

  state.quantity = state.quantity.plus(quantity);
  state.cost = state.cost.plus(cost);
};

const applySell = (state: Internal, entry: LedgerEntry): void => {
  const asked = decimal(entry.quantity);
  const sold = Decimal.min(asked, state.quantity);

  if (asked.greaterThan(state.quantity)) state.oversold = true;

  const average = state.quantity.isZero() ? zero : state.cost.dividedBy(state.quantity);

  // Venda parcial consome custo proporcional ao preço médio, e o preço médio
  // das cotas restantes não muda.
  const consumed = average.times(sold).toDecimalPlaces(MONEY_DP);
  const proceeds = sold
    .times(decimal(entry.unit_price))
    .minus(decimal(entry.fees))
    .toDecimalPlaces(MONEY_DP);

  state.quantity = state.quantity.minus(sold);
  state.cost = state.quantity.isZero() ? zero : state.cost.minus(consumed);

  state.realized.push({
    entry_id: entry.id ?? null,
    trade_date: entry.trade_date,
    proceeds: proceeds.toFixed(MONEY_DP),
    cost_consumed: consumed.toFixed(MONEY_DP),
    result: proceeds.minus(consumed).toFixed(MONEY_DP),
  });
};

/**
 * Transferência preserva o preço médio nas duas pontas e não gera resultado
 * realizado: é reclassificação interna, não venda.
 *
 * As duas pernas usam **o mesmo número** — o valor líquido gravado no
 * lançamento, que é a parcela do custo que viajou. Recalcular o custo em cada
 * ponta a partir do preço médio arredondado deixaria um centavo de diferença
 * entre o que saiu e o que entrou, e a invariante "transferência preserva
 * patrimônio total" tem tolerância zero.
 */
const applyTransfer = (state: Internal, entry: LedgerEntry): void => {
  const quantity = decimal(entry.quantity);
  const cost = decimal(entry.net_amount).abs().toDecimalPlaces(MONEY_DP);

  if (isOutgoing(entry)) {
    const moving = Decimal.min(quantity, state.quantity);
    if (quantity.greaterThan(state.quantity)) state.oversold = true;

    state.quantity = state.quantity.minus(moving);
    state.cost = state.quantity.isZero()
      ? zero
      : Decimal.max(state.cost.minus(cost), zero);
    return;
  }

  state.quantity = state.quantity.plus(quantity);
  state.cost = state.cost.plus(cost);
};

/**
 * A parcela do custo que viaja numa transferência: proporcional à quantidade
 * movida, e o custo inteiro quando a posição toda sai. É o que faz a soma das
 * duas carteiras ser idêntica à de antes, sem sobra de centavo.
 */
export const proportionalCost = (
  costBasis: string,
  quantity: string,
  available: string,
): string => {
  const total = new Decimal(costBasis);
  const moving = new Decimal(quantity);
  const held = new Decimal(available);

  if (held.isZero() || moving.greaterThanOrEqualTo(held)) return total.toFixed(MONEY_DP);

  return total.times(moving).dividedBy(held).toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);
};

/**
 * Desdobramento, grupamento e bonificação mudam quantidade e preço médio; o
 * custo total não muda. A sobra de um grupamento fica como fração em vez de
 * virar perda de custo.
 */
const applyCorporateEvent = (state: Internal, entry: LedgerEntry): void => {
  const from = decimal(entry.event_ratio_from);
  const to = decimal(entry.event_ratio_to);

  if (from.isZero() || to.isZero()) return;

  state.quantity = state.quantity.times(to).dividedBy(from);
};

/** Amortização devolve principal: reduz o custo em vez de contar rendimento. */
const applyPayout = (state: Internal, entry: LedgerEntry): void => {
  if (entry.payout_kind !== 'amortization') return;

  const amount = decimal(entry.net_amount).abs().toDecimalPlaces(MONEY_DP);

  state.cost = Decimal.max(state.cost.minus(amount), zero);
};

export type ApplyOptions = {
  /** Posição em uma data: o que a tela de preview chama de "antes". */
  readonly until?: string | undefined;
};

export const applyLedger = (
  entries: readonly LedgerEntry[],
  options: ApplyOptions = {},
): LedgerState => {
  const state: Internal = {
    quantity: zero,
    cost: zero,
    realized: [],
    oversold: false,
  };

  for (const entry of sortEntries(entries)) {
    if (options.until !== undefined && entry.trade_date > options.until) break;

    switch (entry.kind) {
      case 'buy':
        applyBuy(state, entry);
        break;
      case 'sell':
        applySell(state, entry);
        break;
      case 'transfer':
        applyTransfer(state, entry);
        break;
      case 'corporate_event':
        applyCorporateEvent(state, entry);
        break;
      case 'payout':
        applyPayout(state, entry);
        break;
      // Aporte e resgate movem caixa, não posição de ativo: quem responde por
      // eles é `cashBalance`.
      case 'deposit':
      case 'withdrawal':
        break;
    }
  }

  const quantity = state.quantity.toDecimalPlaces(QUANTITY_DP);
  const cost = state.cost.toDecimalPlaces(MONEY_DP);
  const average = quantity.isZero() ? zero : cost.dividedBy(quantity);

  const realizedTotal = state.realized.reduce(
    (total, sale) => total.plus(new Decimal(sale.result)),
    zero,
  );

  return {
    position: {
      quantity: quantity.toFixed(QUANTITY_DP),
      avg_price: average.toDecimalPlaces(PRICE_DP).toFixed(PRICE_DP),
      cost_basis: cost.toFixed(MONEY_DP),
    },
    realized: state.realized,
    realized_total: realizedTotal.toFixed(MONEY_DP),
    oversold: state.oversold,
  };
};

/** A posição de um ativo numa data, que é o "antes" de todo preview. */
export const positionAt = (entries: readonly LedgerEntry[], date: string): Position =>
  applyLedger(entries, { until: date }).position;

/**
 * O caixa não é coluna de saldo: é a soma dos valores líquidos que entraram e
 * saíram naquela carteira e instituição. Compra tira, venda e provento põem,
 * aporte põe, resgate tira — e o caixa aparece em Posições como ativo sintético.
 */
export const cashBalance = (entries: readonly LedgerEntry[]): string =>
  entries
    .reduce((total, entry) => total.plus(decimal(entry.net_amount)), zero)
    .toDecimalPlaces(MONEY_DP)
    .toFixed(MONEY_DP);
