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

  const tax = base.times(rate).dividedBy(100).toDecimalPlaces(MONEY_DP);

  return {
    elapsed_days: elapsed,
    gross_value: gross.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP),
    taxable_base: base.toFixed(MONEY_DP),
    tax_rate: rate.toFixed(2),
    tax_due: tax.toFixed(MONEY_DP),
    net_value: gross.minus(tax).toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP),
  };
};
