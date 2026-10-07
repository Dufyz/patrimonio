import type { DailyTotals } from '../../quota/series.js';

/**
 * Séries de fechamento conferidas à mão. Em todas elas `total_value` é a soma das
 * posições do dia e `net_flow` é só o dinheiro que cruzou a fronteira do
 * patrimônio — transferência entre carteiras nunca aparece aqui.
 */
const day = (
  position_date: string,
  total_value: string,
  net_flow: string,
  payouts = '0.00',
): DailyTotals => ({ position_date, total_value, net_flow, payouts });

/**
 * Março: aporte inicial, alta, aporte no meio do mês sem o mercado andar,
 * provento e um dia de queda. O aporte do dia 5 é o caso que importa — a
 * quantidade de cotas sobe e o valor da cota fica exatamente onde estava.
 */
export const marchWithContribution: readonly DailyTotals[] = [
  day('2024-03-01', '10000.00', '10000.00'),
  day('2024-03-04', '10100.00', '0.00'),
  day('2024-03-05', '15100.00', '5000.00'),
  day('2024-03-06', '15251.00', '0.00'),
  day('2024-03-07', '15301.00', '0.00', '50.00'),
  day('2024-03-08', '15000.00', '0.00'),
];

/** Resgate total e novo aporte depois: a série continua, não recomeça. */
export const fullRedemptionThenContribution: readonly DailyTotals[] = [
  day('2024-04-01', '10000.00', '10000.00'),
  day('2024-04-02', '10500.00', '0.00'),
  day('2024-04-03', '0.00', '-10500.00'),
  day('2024-04-04', '0.00', '0.00'),
  day('2024-04-05', '2100.00', '2100.00'),
];

/** Dia sem preço novo: o valor repete, e isso não é variação. */
export const staleDay: readonly DailyTotals[] = [
  day('2024-05-02', '5000.00', '5000.00'),
  day('2024-05-03', '5100.00', '0.00'),
  day('2024-05-06', '5100.00', '0.00'),
];

/** Dois meses, para a decomposição e a grade mês por ano. */
export const twoMonths: readonly DailyTotals[] = [
  ...marchWithContribution,
  day('2024-04-01', '15300.00', '0.00'),
  day('2024-04-02', '16000.00', '500.00'),
  day('2024-04-30', '16500.00', '0.00', '120.00'),
];
