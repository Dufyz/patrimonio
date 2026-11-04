import { Decimal } from 'decimal.js';

import { calendarDaysBetween } from '../support/dates.js';

/**
 * A tabela regressiva do IR em renda fixa. A alíquota cai com o prazo, e o prazo
 * conta **dia corrido**, não dia útil — é a única contagem do motor que não passa
 * por `business_day`, e confundir as duas muda a alíquota em volta de cada
 * fronteira.
 *
 * As faixas da lei: até 180 dias 22,5%; de 181 a 360 dias 20%; de 361 a 720 dias
 * 17,5%; acima de 720 dias 15%. O limite superior de cada faixa é inclusive, e é
 * por isso que o dia 180 ainda paga 22,5% e o 181 já paga 20%.
 */
export type RegressiveBracket = {
  /** Limite superior da faixa, inclusive. Nulo na última. */
  readonly through_days: number | null;
  readonly rate: string;
};

export const REGRESSIVE_BRACKETS: readonly RegressiveBracket[] = [
  { through_days: 180, rate: '22.5' },
  { through_days: 360, rate: '20' },
  { through_days: 720, rate: '17.5' },
  { through_days: null, rate: '15' },
];

const MONEY_DP = 2;

/**
 * O IOF sobre o rendimento de resgate em renda fixa: regressivo por dia corrido,
 * de 96% no 1º dia a 3% no 29º, e zero a partir do 30º. Incide antes do IR — a
 * base do IR é o rendimento já descontado do IOF. O dia da aplicação (0) não
 * rende nada que valha tributar, mas o resgate no mesmo dia também paga 0.
 */
export const IOF_RATES: readonly number[] = [
  0, 96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50, 46, 43, 40, 36, 33, 30,
  26, 23, 20, 16, 13, 10, 6, 3,
];

/** A alíquota do IOF, em %, para os dias corridos desde a aplicação. */
export const iofRate = (elapsedDays: number): string => {
  if (elapsedDays <= 0 || elapsedDays >= IOF_RATES.length) return '0';
  return String(IOF_RATES[elapsedDays]);
};

export const regressiveRate = (elapsedDays: number): string => {
  for (const bracket of REGRESSIVE_BRACKETS) {
    if (bracket.through_days === null) return bracket.rate;
    if (elapsedDays <= bracket.through_days) return bracket.rate;
  }

  return '15';
};

/** O regime do papel. Isento não aplica tabela nenhuma. */
export const TAX_REGIMES = ['regressive', 'exempt'] as const;

export type FixedIncomeTaxRegime = (typeof TAX_REGIMES)[number];

export type RedemptionInput = {
  /** Valor aplicado, que é o que não é tributado. */
  readonly principal: string;
  /** Valor na curva na data do resgate. */
  readonly gross_value: string;
  readonly issued_at: string;
  readonly redemption_date: string;
  readonly tax_regime: FixedIncomeTaxRegime;
};

export type Redemption = {
  readonly elapsed_days: number;
  readonly gross_value: string;
  /** O rendimento, que é a base do imposto. */
  readonly taxable_base: string;
  /** IOF, em %, sobre o rendimento: só nos primeiros 29 dias. */
  readonly iof_rate: string;
  readonly iof_due: string;
  /** O IR incide sobre o rendimento depois do IOF. */
  readonly tax_rate: string;
  readonly tax_due: string;
  readonly net_value: string;
};

/**
 * O líquido de resgate aparece separado do bruto na curva porque são duas
 * respostas diferentes: o bruto é quanto o título vale, o líquido é quanto cai
 * na conta se o resgate for hoje. Mostrar só um dos dois faz a tela mentir em
 * uma das duas perguntas.
 */
export const redemption = (input: RedemptionInput): Redemption => {
  const elapsed = calendarDaysBetween(input.issued_at, input.redemption_date);

  const gross = new Decimal(input.gross_value);
  const principal = new Decimal(input.principal);

  // Prejuízo em renda fixa não gera crédito: a base é o rendimento, e rendimento
  // negativo não é base negativa.
  const base = Decimal.max(gross.minus(principal), 0).toDecimalPlaces(MONEY_DP);

  // LCI, LCA, CRI, CRA e debênture incentivada não aplicam a tabela: o rendimento
  // inteiro é do investidor, e a alíquota é zero, não "a de mais de 720 dias".
  const rate =
    input.tax_regime === 'exempt' ? new Decimal(0) : new Decimal(regressiveRate(elapsed));

  const iofRateValue = new Decimal(iofRate(elapsed));
  const iof = base.times(iofRateValue).dividedBy(100).toDecimalPlaces(MONEY_DP);

  const tax = Decimal.max(base.minus(iof), 0)
    .times(rate)
    .dividedBy(100)
    .toDecimalPlaces(MONEY_DP);

  return {
    elapsed_days: elapsed,
    gross_value: gross.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP),
    taxable_base: base.toFixed(MONEY_DP),
    iof_rate: iofRateValue.toFixed(2),
    iof_due: iof.toFixed(MONEY_DP),
    tax_rate: rate.toFixed(2),
    tax_due: tax.toFixed(MONEY_DP),
    net_value: gross.minus(iof).minus(tax).toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP),
  };
};
