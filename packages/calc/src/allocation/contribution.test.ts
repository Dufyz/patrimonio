import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { planContribution } from './contribution.js';
import type { ContributionLine } from './contribution.js';

/** A carteira da prancha 09: 318.904,12 em seis linhas. */
const carteira: readonly ContributionLine[] = [
  { category_id: 'acoes', value: '112640.35', target_pct: '35' },
  { category_id: 'fiis', value: '76820.50', target_pct: '25' },
  { category_id: 'inflacao', value: '80950.40', target_pct: '25' },
  { category_id: 'prefixada', value: '41300.00', target_pct: '12' },
  { category_id: 'posfixada', value: '0.00', target_pct: '0' },
  { category_id: 'caixa', value: '7192.87', target_pct: '3' },
];

describe('aporte contra o alvo', () => {
  it('compra só o que fica abaixo do alvo, e nada do que fica acima', () => {
    const plan = planContribution(carteira, '4000.00');
    const compradas = plan.shares.map((share) => share.category_id).sort();

    // Depois de 4.000 o patrimônio é 322.904,12: Ações (35%) ainda ficam um
    // pouco abaixo do alvo, e RF inflação, prefixada e pós-fixada já passam.
    expect(compradas).toEqual(['acoes', 'caixa', 'fiis']);
    expect(plan.shares.every((share) => new Decimal(share.amount).greaterThan(0))).toBe(true);
  });

  it('reparte o aporte inteiro quando a falta é maior que ele', () => {
    const plan = planContribution(carteira, '4000.00');

    expect(plan.allocated).toBe('4000.00');
    expect(plan.unallocated).toBe('0.00');
  });

  it('a soma das partes é exatamente o aporte, sem centavo perdido', () => {
    const plan = planContribution(
      [
        { category_id: 'a', value: '100.00', target_pct: '33.33' },
        { category_id: 'b', value: '100.00', target_pct: '33.33' },
        { category_id: 'c', value: '100.00', target_pct: '33.34' },
      ],
      '100.00',
    );

    const soma = plan.shares.reduce(
      (total, share) => total.plus(new Decimal(share.amount)),
      new Decimal(0),
    );

    expect(soma.toFixed(2)).toBe(plan.allocated);
    expect(plan.allocated).toBe('100.00');
  });

  it('o maior desvio diminui depois do aporte', () => {
    const plan = planContribution(carteira, '4000.00');

    expect(new Decimal(plan.max_deviation_after_pp ?? '0').lessThan(
      new Decimal(plan.max_deviation_before_pp ?? '0'),
    )).toBe(true);
  });

  it('o desvio depois leva o patrimônio depois do aporte como base', () => {
    const plan = planContribution(
      [
        { category_id: 'a', value: '600.00', target_pct: '50' },
        { category_id: 'b', value: '400.00', target_pct: '50' },
      ],
      '200.00',
    );

    // 1.200 depois: o alvo de b é 600, faltam 200 — o aporte inteiro.
    expect(plan.shares).toEqual([
      { category_id: 'b', amount: '200.00', deviation_after_pp: '0.00' },
    ]);
    expect(plan.max_deviation_before_pp).toBe('10.00');
    expect(plan.max_deviation_after_pp).toBe('0.00');
  });

  it('o que o alvo não pede fica sem alocar, em vez de estourar outra categoria', () => {
    // Só uma categoria tem alvo (30%) e já passa dele depois do aporte.
    const plan = planContribution(
      [
        { category_id: 'a', value: '100.00', target_pct: '30' },
        { category_id: 'sem_alvo', value: '900.00', target_pct: null },
      ],
      '100.00',
    );

    // Depois: 1.100; 30% = 330; faltam 230 > aporte, então compra 100.
    expect(plan.allocated).toBe('100.00');

    const folgada = planContribution(
      [
        { category_id: 'a', value: '290.00', target_pct: '30' },
        { category_id: 'sem_alvo', value: '710.00', target_pct: null },
      ],
      '100.00',
    );

    // Depois: 1.100; 30% = 330; faltam 40 < 100, então 60 ficam sem alocar.
    expect(folgada.allocated).toBe('40.00');
    expect(folgada.unallocated).toBe('60.00');
  });

  it('categoria sem alvo entra no total mas não recebe', () => {
    const plan = planContribution(
      [
        { category_id: 'a', value: '100.00', target_pct: '50' },
        { category_id: 'b', value: '100.00', target_pct: '50' },
        { category_id: 'sem_alvo', value: '800.00', target_pct: null },
      ],
      '100.00',
    );

    expect(plan.shares.map((share) => share.category_id)).not.toContain('sem_alvo');
  });

  it('sem nenhum alvo não há o que sugerir', () => {
    const plan = planContribution(
      [{ category_id: 'a', value: '100.00', target_pct: null }],
      '50.00',
    );

    expect(plan.shares).toEqual([]);
    expect(plan.allocated).toBe('0.00');
    expect(plan.unallocated).toBe('50.00');
    expect(plan.max_deviation_before_pp).toBeNull();
    expect(plan.max_deviation_after_pp).toBeNull();
  });

  it('aporte zero ou negativo não sugere compra', () => {
    expect(planContribution(carteira, '0').shares).toEqual([]);
    expect(planContribution(carteira, '-10').shares).toEqual([]);
    expect(planContribution(carteira, '-10').amount).toBe('0.00');
  });

  it('carteira vazia com alvo divide o primeiro aporte pelo alvo', () => {
    const plan = planContribution(
      [
        { category_id: 'a', value: '0.00', target_pct: '60' },
        { category_id: 'b', value: '0.00', target_pct: '40' },
      ],
      '1000.00',
    );

    expect(plan.shares).toEqual([
      { category_id: 'a', amount: '600.00', deviation_after_pp: '0.00' },
      { category_id: 'b', amount: '400.00', deviation_after_pp: '0.00' },
    ]);
  });
});
