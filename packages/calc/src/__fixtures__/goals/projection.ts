import type { GoalInput } from '../../goals/projection.js';

/**
 * Meta de R$ 500 mil em reais de hoje, dez anos à frente, com retorno real de 4%
 * ao ano e IPCA de 4% ao ano. É o cenário que mostra por que a correção importa:
 * a meta nominal na data alvo é R$ 740.122,14, e não R$ 500 mil — projetar contra
 * os R$ 500 mil diria que o ritmo chega quando ele não chega.
 */
export const independenceInTodayBrl: GoalInput = {
  reference_date: '2026-01-01',
  current_value: '120000.00',
  target_amount: '500000.00',
  target_date: '2036-01-01',
  amount_in_today_brl: true,
  annual_return_pct: '4',
  annual_inflation_pct: '4',
  monthly_contribution: '2500.00',
};

/** A mesma meta declarada em reais nominais: nada é corrigido. */
export const independenceInNominalBrl: GoalInput = {
  ...independenceInTodayBrl,
  amount_in_today_brl: false,
};

/** Doze meses, sem retorno e sem inflação: a conta é de cabeça. */
export const simpleTwelveMonths: GoalInput = {
  reference_date: '2026-01-01',
  current_value: '0.00',
  target_amount: '120000.00',
  target_date: '2027-01-01',
  amount_in_today_brl: false,
  annual_return_pct: '0',
  annual_inflation_pct: '0',
  monthly_contribution: '10000.00',
};

/** Objetivo já cumprido com folga: o excedente não pode virar barra estourada. */
export const alreadyReached: GoalInput = {
  ...simpleTwelveMonths,
  current_value: '150000.00',
  target_amount: '100000.00',
};
