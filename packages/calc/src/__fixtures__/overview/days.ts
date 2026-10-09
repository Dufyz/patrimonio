import type { OverviewDay } from '../../overview/summary.js';

/**
 * Quatro dias conferidos à mão. O terceiro tem aporte e queda no mesmo dia, que
 * é o caso que separa "o patrimônio subiu" de "a carteira rendeu": o total
 * cresce porque entrou dinheiro, e o rendimento do dia é negativo.
 */
export const fourDays: readonly OverviewDay[] = [
  {
    position_date: '2026-09-29',
    total_value: '100000.00',
    net_flow: '0.00',
    income: '0.00',
    payouts: '0.00',
    cumulative_contributions: '90000.00',
  },
  {
    position_date: '2026-09-30',
    total_value: '101000.00',
    net_flow: '0.00',
    income: '1000.00',
    payouts: '0.00',
    cumulative_contributions: '90000.00',
  },
  {
    position_date: '2026-10-01',
    total_value: '105500.00',
    net_flow: '5000.00',
    income: '-500.00',
    payouts: '0.00',
    cumulative_contributions: '95000.00',
  },
  {
    position_date: '2026-10-02',
    total_value: '105900.00',
    net_flow: '0.00',
    income: '400.00',
    payouts: '150.00',
    cumulative_contributions: '95000.00',
  },
];

/** Carteira que começou vazia: a variação existe em dinheiro e não em proporção. */
export const fromEmpty: readonly OverviewDay[] = [
  {
    position_date: '2026-10-01',
    total_value: '0.00',
    net_flow: '0.00',
    income: '0.00',
    payouts: '0.00',
    cumulative_contributions: '0.00',
  },
  {
    position_date: '2026-10-02',
    total_value: '1000.00',
    net_flow: '1000.00',
    income: '0.00',
    payouts: '0.00',
    cumulative_contributions: '1000.00',
  },
];

/** Prejuízo: o patrimônio está abaixo do que foi aportado. */
export const underwater: readonly OverviewDay[] = [
  {
    position_date: '2026-10-02',
    total_value: '88000.00',
    net_flow: '0.00',
    income: '-2000.00',
    payouts: '0.00',
    cumulative_contributions: '95000.00',
  },
];
