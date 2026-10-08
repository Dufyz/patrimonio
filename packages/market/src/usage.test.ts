import { describe, expect, it } from 'vitest';

import { BRAPI_FREE_MONTHLY_CEILING } from './providers/brapi.provider.js';
import { budgetFor, monthlyProjection } from './usage.js';

describe('o teto do plano gratuito', () => {
  it('trinta ativos num mês ficam bem abaixo do teto', () => {
    const projetado = monthlyProjection({
      requestsPerCollection: 30,
      businessDaysPerMonth: 21,
    });

    // 630 chamadas mais 30% de folga, contra 15.000.
    expect(projetado).toBe(819);

    const orcamento = budgetFor({
      source: 'brapi',
      used: projetado,
      ceiling: BRAPI_FREE_MONTHLY_CEILING,
    });

    expect(orcamento.exceeded).toBe(false);
    expect(orcamento.warning).toBe(false);
    expect(orcamento.remaining).toBe(14_181);
  });

  it('a carteira que aperta o teto é avisada antes de apertar', () => {
    const orcamento = budgetFor({
      source: 'brapi',
      used: 12_500,
      ceiling: BRAPI_FREE_MONTHLY_CEILING,
    });

    expect(orcamento.warning).toBe(true);
    expect(orcamento.exceeded).toBe(false);
  });

  it('estourado é estourado, e a conta diz quanto', () => {
    const orcamento = budgetFor({ source: 'brapi', used: 15_400, ceiling: 15_000 });

    expect(orcamento.exceeded).toBe(true);
    expect(orcamento.remaining).toBe(0);
    expect(orcamento.ratio).toBeCloseTo(1.0267, 4);
  });

  it('fonte sem teto declarado não estoura nem avisa', () => {
    const orcamento = budgetFor({ source: 'bcb', used: 90_000, ceiling: 0 });

    expect(orcamento.exceeded).toBe(false);
    expect(orcamento.warning).toBe(false);
    expect(orcamento.ratio).toBe(0);
  });

  it('consumo negativo é tratado como zero, não como crédito', () => {
    expect(budgetFor({ source: 'brapi', used: -5, ceiling: 100 }).used).toBe(0);
  });

  it('a projeção do plano pago cai com o lote de dez por chamada', () => {
    const gratuito = monthlyProjection({
      requestsPerCollection: 100,
      businessDaysPerMonth: 21,
    });
    const pago = monthlyProjection({
      requestsPerCollection: 10,
      businessDaysPerMonth: 21,
    });

    expect(gratuito).toBe(2_730);
    expect(pago).toBe(273);
  });
});
