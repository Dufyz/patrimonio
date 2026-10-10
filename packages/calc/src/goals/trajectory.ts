import { Decimal } from 'decimal.js';

import { monthsBetween } from '../support/dates.js';
import { monthlyRate, projectGoal } from './projection.js';

/**
 * O que a tela de Objetivos precisa além da projeção: ler a premissa que o
 * usuário escreveu, desenhar as duas trajetórias, dizer onde o objetivo
 * deveria estar hoje e montar a tabela de aportes para escolher.
 *
 * ## Por que a tela trabalha em reais de hoje
 *
 * A meta de "R$ 1,5 mi em reais de hoje" é uma linha **reta** no gráfico, e o
 * patrimônio cresce à taxa **real** — retorno acima da inflação. As duas pontas
 * ficam na mesma moeda, e o aporte mensal também: R$ 2.133 hoje e R$ 2.133 em
 * 2040 são o mesmo poder de compra. É a leitura que a prancha desenha e a
 * única em que "IPCA + 6%" quer dizer 6.
 *
 * `projectGoal` em modo `amount_in_today_brl` faz outra coisa: infla a meta
 * pelo IPCA e compõe o patrimônio pela taxa que recebeu. Com uma taxa real isso
 * cobra a inflação **do alvo** sem pagá-la **ao patrimônio**, e a meta parece
 * mais longe do que está. Por isso as funções daqui chamam `projectGoal` sempre
 * com `amount_in_today_brl: false` — a meta já está na moeda da taxa — e quem
 * precisa de uma meta nominal passa uma taxa nominal (`nominalRate`).
 */
const MONEY_DP = 2;

const Big = Decimal.clone({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

const zero = new Big(0);
const one = new Big(1);
const hundred = new Big(100);

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

/* -------------------------------------------------------------------------- */
/* A premissa                                                                  */

/**
 * `IPCA+6` é "inflação mais seis por cento ao ano"; `6` é "seis por cento ao
 * ano", sem indexador. A diferença importa porque só a primeira muda de
 * significado quando a meta é nominal.
 */
export type ReturnAssumption = {
  readonly kind: 'ipca_plus' | 'fixed';
  /** A taxa em %, com duas casas: `IPCA+6` → `6.00`. */
  readonly rate_pct: string;
};

const ASSUMPTION = /^(?:ipca(?:\+(\d+(?:\.\d+)?))?|(\d+(?:\.\d+)?))$/;

/**
 * Lê o texto que o usuário guardou: `IPCA+6`, `IPCA + 6%`, `ipca+6,5`, `6`,
 * `6,5% a.a.`. O que não se reconhece devolve `null` — e a tela diz que a
 * premissa não foi entendida, em vez de projetar com uma taxa adivinhada.
 */
export const parseReturnAssumption = (text: string | null): ReturnAssumption | null => {
  if (text === null) return null;

  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/(?:a\.a\.|aa)$/, '')
    .replace(/%/g, '');

  const match = ASSUMPTION.exec(normalized);
  if (match === null) return null;

  if (match[2] !== undefined) {
    return { kind: 'fixed', rate_pct: new Big(match[2]).toFixed(2) };
  }

  return { kind: 'ipca_plus', rate_pct: new Big(match[1] ?? '0').toFixed(2) };
};

/**
 * A taxa nominal de uma taxa real e de uma inflação: `(1 + r)(1 + i) − 1`. É
 * composta, e não a soma `r + i`: 6% sobre 4,5% é 10,77%, não 10,5%.
 */
export const nominalRate = (realPct: string, inflationPct: string): string =>
  one
    .plus(new Big(realPct).dividedBy(hundred))
    .times(one.plus(new Big(inflationPct).dividedBy(hundred)))
    .minus(one)
    .times(hundred)
    .toFixed(4);

/* -------------------------------------------------------------------------- */
/* Onde está                                                                   */

export type GoalStanding = {
  /** Nunca passa de 100: o excedente sai em `surplus_brl`. */
  readonly progress_pct: string;
  /** Quanto falta hoje. Zero quando já está feito. */
  readonly remaining_brl: string;
  readonly surplus_brl: string | null;
};

/** O objetivo contra a meta de hoje, sem projeção nenhuma. */
export const goalStanding = (current: string, target: string): GoalStanding => {
  const present = new Big(current);
  const goal = new Big(target);

  const progress = goal.isZero() ? zero : present.dividedBy(goal).times(hundred);
  const difference = goal.minus(present);

  return {
    progress_pct: Decimal.min(Decimal.max(progress, zero), hundred)
      .toDecimalPlaces(MONEY_DP)
      .toFixed(MONEY_DP),
    remaining_brl: money(Decimal.max(difference, zero)),
    surplus_brl: difference.isNegative() ? money(difference.negated()) : null,
  };
};

export type ExpectedProgressInput = {
  /** De onde a trajetória necessária parte: o dia em que o objetivo começou. */
  readonly start_date: string;
  readonly start_value: string;
  readonly reference_date: string;
  readonly target_amount: string;
  readonly target_date: string;
  readonly annual_return_pct: string;
};

/**
 * Onde o objetivo deveria estar **hoje** para chegar no prazo: o aporte que
 * fecharia a meta a partir do começo, aplicado até a data de referência.
 *
 * É a marca na barra de progresso. Ela é diferente da trajetória tracejada do
 * gráfico, que parte de hoje: aquela responde "o que falta daqui para frente",
 * esta responde "eu estaria onde, se tivesse seguido o plano desde o início".
 * Passar da marca é o que separa "no caminho" de "atrasado".
 *
 * Nulo quando não há tempo decorrido para medir (o objetivo começou hoje).
 */
export const expectedProgress = (input: ExpectedProgressInput): string | null => {
  if (input.start_date >= input.reference_date) return null;

  const target = new Big(input.target_amount);
  if (target.isZero()) return null;

  const base = {
    reference_date: input.start_date,
    current_value: input.start_value,
    target_amount: input.target_amount,
    amount_in_today_brl: false,
    annual_return_pct: input.annual_return_pct,
  } as const;

  // Prazo que já passou no começo: a meta era para ontem, e o esperado é tudo.
  if (monthsBetween(input.start_date, input.target_date) <= 0) return '100.00';

  const required = projectGoal({
    ...base,
    target_date: input.target_date,
    monthly_contribution: '0',
  }).required_monthly;

  const expected = projectGoal({
    ...base,
    target_date: input.reference_date,
    monthly_contribution: required,
  }).projected_amount;

  return Decimal.min(new Big(expected).dividedBy(target).times(hundred), hundred)
    .toDecimalPlaces(MONEY_DP)
    .toFixed(MONEY_DP);
};

/* -------------------------------------------------------------------------- */
/* A trajetória                                                                */

export type TrajectoryInput = {
  readonly current_value: string;
  readonly monthly_contribution: string;
  readonly annual_return_pct: string;
  readonly months: number;
};

/**
 * O valor no fim de cada mês, de zero (hoje) a `months`: `months + 1` pontos.
 * Mesma conta de `projectGoal` — aporte no fim do mês, taxa composta —, passo a
 * passo, para o gráfico e a projeção nunca divergirem no último ponto.
 */
export const goalTrajectory = (input: TrajectoryInput): readonly string[] => {
  const rate = monthlyRate(input.annual_return_pct);
  const monthly = new Big(input.monthly_contribution);

  const values: string[] = [];
  let value = new Big(input.current_value);

  for (let month = 0; month <= Math.max(input.months, 0); month += 1) {
    values.push(money(value));
    value = value.times(one.plus(rate)).plus(monthly);
  }

  return values;
};

/* -------------------------------------------------------------------------- */
/* A tabela de aportes                                                         */

export type LadderEntry = {
  readonly amount: string;
  /**
   * `current` é o ritmo de hoje; `required` é o que fecha a meta na data;
   * `option` é um valor redondo para o usuário comparar.
   */
  readonly kind: 'current' | 'required' | 'option';
};

/**
 * O passo do arredondamento acompanha a grandeza: R$ 3.041 vira 3.000, e não
 * 3.040, porque ninguém programa uma transferência de R$ 3.040.
 */
const niceStep = (value: Decimal): number => {
  if (value.lt(1000)) return 50;
  if (value.lt(5000)) return 500;
  if (value.lt(20_000)) return 1000;

  return 5000;
};

const roundNice = (value: Decimal): Decimal => {
  const step = niceStep(value);

  return value.dividedBy(step).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(step);
};

/** Dois valores a menos de 3% um do outro não são duas escolhas. */
const NEAR = new Big('0.03');

const isNear = (left: Decimal, right: Decimal): boolean =>
  left.minus(right).abs().lessThanOrEqualTo(Decimal.max(left, right).times(NEAR));

/**
 * Os aportes que a tabela compara: o ritmo atual, o necessário e dois valores
 * redondos — um entre os dois e um acima do necessário. Em ordem crescente.
 *
 * O ritmo de quem já está no caminho não ganha opções acima: a pergunta dele é
 * "posso aportar menos?", e a linha do necessário responde.
 */
export const contributionLadder = (
  current: string,
  required: string,
): readonly LadderEntry[] => {
  const pace = new Big(current);
  const needed = new Big(required);

  const entries: { amount: Decimal; kind: LadderEntry['kind'] }[] = [
    { amount: pace, kind: 'current' },
  ];

  if (needed.isPositive() && !needed.eq(pace)) {
    entries.push({ amount: needed, kind: 'required' });
  }

  if (needed.isPositive() && pace.lt(needed)) {
    const candidates = [
      roundNice(pace.plus(needed).dividedBy(2)),
      roundNice(needed.times('1.25')),
    ];

    for (const candidate of candidates) {
      if (!candidate.isPositive()) continue;
      if (entries.some((entry) => isNear(entry.amount, candidate))) continue;

      entries.push({ amount: candidate, kind: 'option' });
    }
  }

  return entries
    .sort((left, right) => left.amount.comparedTo(right.amount))
    .map((entry) => ({ amount: money(entry.amount), kind: entry.kind }));
};

/* -------------------------------------------------------------------------- */
/* Taxas e fatores                                                             */

/**
 * A taxa escrita como a tela a mostra: no mínimo duas casas, no máximo quatro.
 * `6` vira `6.00` e `10.77` fica `10.77`, mas `6.12345` não ganha casas que o
 * usuário não escolheu.
 */
export const normalizeRate = (rate: string): string => {
  const value = new Big(rate);

  return value.toFixed(Math.min(4, Math.max(2, value.decimalPlaces())));
};

/** `1.0451` → `4.51`: o fator acumulado de um período, em %. */
export const factorToPct = (factor: string): string =>
  new Big(factor).minus(one).times(hundred).toFixed(MONEY_DP);
