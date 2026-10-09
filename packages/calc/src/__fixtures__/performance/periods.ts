import type { QuotaPoint } from '../../quota/windows.js';
import type { FactorsByIndex } from '../../quota/benchmark.js';

/**
 * Dois anos curtos, conferidos à mão. A carteira começa em 2024-11-29 com cota
 * 1,00 e fecha o ano em 1,10; em 2025 chega a 1,21. Os números redondos são
 * de propósito: 10% e 10%, e o acumulado de 21% — que é 1,10 × 1,10 − 1, e não
 * 10% + 10% — é o que prova que o retorno do ano é composto.
 */
export const quotaPoints: readonly QuotaPoint[] = [
  { position_date: '2024-11-29', quota_value: '1.000000000000' },
  { position_date: '2024-12-02', quota_value: '1.050000000000' },
  { position_date: '2024-12-31', quota_value: '1.100000000000' },
  { position_date: '2025-01-02', quota_value: '1.111000000000' },
  { position_date: '2025-06-30', quota_value: '1.150000000000' },
  { position_date: '2025-12-31', quota_value: '1.210000000000' },
];

/** Um índice de 1% ao dia em quatro dias úteis: 1,01⁴ − 1 = 4,06%. */
export const onePercentDaily: FactorsByIndex = new Map([
  [
    'IDX',
    new Map([
      ['2025-03-03', '1.010000000000'],
      ['2025-03-04', '1.010000000000'],
      ['2025-03-05', '1.010000000000'],
      ['2025-03-06', '1.010000000000'],
    ]),
  ],
]);
