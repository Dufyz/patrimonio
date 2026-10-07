import { Decimal } from 'decimal.js';

/**
 * A cota existe para separar o que o dinheiro fez do quanto de dinheiro entrou.
 * Sem ela, uma carteira que recebeu um aporte grande parece ter rendido, e a
 * pergunta "quanto do crescimento veio de aporte e quanto veio de rentabilidade"
 * fica sem resposta — que é a pergunta principal do produto.
 *
 * ## A mecânica, e por que ela é assim
 *
 * O aporte entra ao valor de cota **conhecido**, que é o do dia anterior: ele cria
 * cotas e não mexe no preço delas. O mercado é que mexe no valor da cota. São dois
 * efeitos separados dentro do mesmo dia, e é essa separação que o modelo de dados
 * descreve como "dia com fluxo muda a quantidade de cotas": o fluxo muda a
 * quantidade, nunca o valor.
 *
 * A consequência é a invariante que sustenta a tela: num dia sem fluxo a
 * quantidade de cotas não muda, e num dia em que o mercado não andou o valor da
 * cota não muda — mesmo que tenha havido aporte. `quota_value × quota_count` é
 * sempre `total_value`, na escala de centavos em que o patrimônio é medido.
 *
 * Nenhuma função aqui chama `new Date()`: a série de dias entra como parâmetro.
 */
export const INITIAL_QUOTA_VALUE = '1';

const MONEY_DP = 2;
/** A mesma escala de `portfolio_daily.quota_value`: cota de valor baixo precisa de casas. */
const QUOTA_DP = 12;

const zero = new Decimal(0);

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

const quota = (value: Decimal): string =>
  value.toDecimalPlaces(QUOTA_DP).toFixed(QUOTA_DP);

/** O que o fechamento do dia mediu, antes de a cota existir. */
export type DailyTotals = {
  /** `YYYY-MM-DD` */
  readonly position_date: string;
  /** Soma das posições do dia, a preço de fechamento. */
  readonly total_value: string;
  /**
   * Dinheiro que cruzou a fronteira do patrimônio no dia: aporte menos resgate.
   * Transferência entre carteiras não entra aqui — ela não é dinheiro novo, e
   * contá-la inventaria aporte e apagaria rentabilidade.
   */
  readonly net_flow: string;
  /** Quanto do dia veio de provento, destacado dentro do rendimento. */
  readonly payouts: string;
};

export type QuotaDay = {
  readonly position_date: string;
  readonly total_value: string;
  readonly net_flow: string;
  /** Rendimento do dia, já descontado o fluxo. Negativo quando o mercado caiu. */
  readonly income: string;
  readonly payouts: string;
  readonly quota_value: string;
  readonly quota_count: string;
  readonly cumulative_contributions: string;
};

/** O dia anterior ao início do intervalo, de onde a série continua. */
export type QuotaSeed = {
  readonly position_date: string;
  readonly total_value: string;
  readonly quota_value: string;
  readonly quota_count: string;
  readonly cumulative_contributions: string;
};

export type QuotaOptions = {
  /**
   * Ausente só no primeiro dia da história da carteira. Num recálculo a partir
   * de uma data, é a linha do dia anterior — e é o que faz reconstruir um
   * pedaço produzir a mesma série que reconstruir tudo.
   */
  readonly previous?: QuotaSeed | undefined;
  readonly initial_quota_value?: string | undefined;
};

type State = {
  totalValue: Decimal;
  quotaValue: Decimal;
  quotaCount: Decimal;
  contributions: Decimal;
};

const seedState = (options: QuotaOptions): State => {
  const previous = options.previous;

  if (previous === undefined) {
    return {
      totalValue: zero,
      quotaValue: new Decimal(options.initial_quota_value ?? INITIAL_QUOTA_VALUE),
      quotaCount: zero,
      contributions: zero,
    };
  }

  return {
    totalValue: new Decimal(previous.total_value),
    quotaValue: new Decimal(previous.quota_value),
    quotaCount: new Decimal(previous.quota_count),
    contributions: new Decimal(previous.cumulative_contributions),
  };
};

export const buildQuotaSeries = (
  days: readonly DailyTotals[],
  options: QuotaOptions = {},
): readonly QuotaDay[] => {
  const state = seedState(options);
  const series: QuotaDay[] = [];

  for (const day of days) {
    const totalValue = new Decimal(day.total_value);
    const netFlow = new Decimal(day.net_flow);
    const payouts = new Decimal(day.payouts);

    // O rendimento é o que sobrou depois de tirar o fluxo da variação. É aqui
    // que aporte deixa de parecer rentabilidade.
    const income = totalValue.minus(state.totalValue).minus(netFlow);

    // O fluxo entra ao valor de cota conhecido — o de ontem. Cria cotas; não
    // reavalia as que já existiam.
    const addedQuotas = state.quotaValue.isZero()
      ? zero
      : netFlow.dividedBy(state.quotaValue).toDecimalPlaces(QUOTA_DP);

    let quotaCount = state.quotaCount.plus(addedQuotas);
    let quotaValue = state.quotaValue;

    if (quotaCount.isPositive()) {
      quotaValue = totalValue.dividedBy(quotaCount).toDecimalPlaces(QUOTA_DP);
    } else if (totalValue.isPositive()) {
      // Resgate total e novo aporte no mesmo dia: a série não reinicia. As cotas
      // são recriadas ao último valor conhecido, que continua positivo.
      quotaCount = totalValue.dividedBy(state.quotaValue).toDecimalPlaces(QUOTA_DP);
    } else {
      // Carteira zerada: nenhuma cota, e o valor da cota é preservado para o
      // próximo aporte continuar a série em vez de começar outra.
      quotaCount = zero;
    }

    state.totalValue = totalValue;
    state.quotaValue = quotaValue;
    state.quotaCount = quotaCount;
    state.contributions = state.contributions.plus(netFlow);

    series.push({
      position_date: day.position_date,
      total_value: money(totalValue),
      net_flow: money(netFlow),
      income: money(income),
      payouts: money(payouts),
      quota_value: quota(quotaValue),
      quota_count: quota(quotaCount),
      cumulative_contributions: money(state.contributions),
    });
  }

  return series;
};

/** A linha que serve de ponto de partida para o intervalo seguinte. */
export const seedFrom = (day: QuotaDay): QuotaSeed => ({
  position_date: day.position_date,
  total_value: day.total_value,
  quota_value: day.quota_value,
  quota_count: day.quota_count,
  cumulative_contributions: day.cumulative_contributions,
});

/**
 * A invariante do modelo, calculável: o produto das duas colunas é o patrimônio
 * do dia, na escala de centavos em que o patrimônio é medido. As duas colunas têm
 * doze casas justamente para o produto fechar no centavo.
 */
export const totalFromQuota = (day: {
  readonly quota_value: string;
  readonly quota_count: string;
}): string => money(new Decimal(day.quota_value).times(new Decimal(day.quota_count)));
