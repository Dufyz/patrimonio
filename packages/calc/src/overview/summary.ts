import { Decimal } from 'decimal.js';

/**
 * Os números que a tela de abertura mostra, calculados aqui e não nela.
 *
 * A regra do projeto é que o `web` não faz aritmética com dinheiro, e a razão
 * aparece justamente nesta tela: o cabeçalho diz "+R$ 1.049,20 · +0,33%", a
 * barra de composição diz "35,3%" e a tabela de maiores posições diz "16,4%" —
 * três números que precisam fechar com o mesmo total. Calculados em dois
 * lugares, eles divergem no arredondamento antes de divergirem em qualquer
 * outra coisa.
 *
 * Nada aqui conhece o relógio: a data de referência e a série entram como
 * parâmetro, e é o que permite reproduzir a tela de um dia qualquer no teste.
 */
const MONEY_DP = 2;
const PCT_DP = 2;

const zero = new Decimal(0);

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

const pct = (value: Decimal): string => value.toDecimalPlaces(PCT_DP).toFixed(PCT_DP);

/** Um dia da série consolidada do escopo, como o fechamento o gravou. */
export type OverviewDay = {
  readonly position_date: string;
  readonly total_value: string;
  readonly net_flow: string;
  readonly income: string;
  readonly payouts: string;
  readonly cumulative_contributions: string;
};

/**
 * Variação em dinheiro e em proporção. A proporção é nula quando a base é zero:
 * uma carteira que começou o mês vazia cresceu em dinheiro, e não cresceu uma
 * porcentagem — `+∞%` é o número plausível e errado que o produto existe para
 * não produzir.
 */
export type ValueChange = {
  readonly amount: string;
  readonly ratio: string | null;
};

export const valueChange = (
  previous: string | null,
  current: string | null,
): ValueChange | null => {
  if (current === null || previous === null) return null;

  const from = new Decimal(previous);
  const difference = new Decimal(current).minus(from);

  return {
    amount: money(difference),
    ratio: from.isZero() ? null : pct(difference.dividedBy(from).times(100)),
  };
};

/**
 * O que atravessou a fronteira do patrimônio na janela, e o que o mercado fez
 * nela. São as duas metades da pergunta principal do produto — quanto do
 * crescimento veio de aporte e quanto veio de rentabilidade — e por isso saem
 * somadas da mesma série, nunca de duas leituras diferentes.
 */
export type PeriodFlows = {
  readonly contributions: string;
  readonly income: string;
  readonly payouts: string;
};

export const periodFlows = (days: readonly OverviewDay[]): PeriodFlows => {
  let contributions = zero;
  let income = zero;
  let payouts = zero;

  for (const day of days) {
    contributions = contributions.plus(new Decimal(day.net_flow));
    income = income.plus(new Decimal(day.income));
    payouts = payouts.plus(new Decimal(day.payouts));
  }

  return {
    contributions: money(contributions),
    income: money(income),
    payouts: money(payouts),
  };
};

/**
 * As faixas do gráfico de evolução: aporte acumulado embaixo, o que o mercado
 * acrescentou em cima. A soma das duas é o patrimônio do dia, e é por isso que
 * a faixa de cima é a diferença e não um número guardado à parte.
 *
 * Patrimônio abaixo do aporte acumulado — prejuízo — devolve a diferença
 * negativa, e quem desenha decide a cor. Cortar em zero esconderia exatamente
 * o caso em que olhar o gráfico importa.
 */
export type GrowthPoint = {
  readonly date: string;
  readonly contributions: string;
  readonly total: string;
  readonly result: string;
};

export const growthSeries = (days: readonly OverviewDay[]): readonly GrowthPoint[] =>
  days.map((day) => ({
    date: day.position_date,
    contributions: money(new Decimal(day.cumulative_contributions)),
    total: money(new Decimal(day.total_value)),
    result: money(
      new Decimal(day.total_value).minus(new Decimal(day.cumulative_contributions)),
    ),
  }));

/**
 * As maiores posições, com o peso de cada uma no total do escopo. A ordenação é
 * por valor, decrescente, e o empate desempata pelo rótulo — duas posições de
 * mesmo valor trocarem de lugar a cada carga é o tipo de coisa que faz a pessoa
 * reler a tabela inteira para ver o que mudou.
 */
export type WeighedItem = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
};

export type WeighedResult<T extends WeighedItem> = T & { readonly weight_pct: string };

export const weighByValue = <T extends WeighedItem>(
  items: readonly T[],
  total: string,
): readonly WeighedResult<T>[] => {
  const base = new Decimal(total);

  return [...items]
    .sort((left, right) => {
      const comparison = new Decimal(right.value).comparedTo(new Decimal(left.value));
      return comparison === 0 ? left.label.localeCompare(right.label) : comparison;
    })
    .map((item) => ({
      ...item,
      weight_pct: base.isZero()
        ? '0.00'
        : pct(new Decimal(item.value).dividedBy(base).times(100)),
    }));
};
