import { describe, expect, it } from 'vitest';

import {
  EMPTY_PLAN,
  formatRate,
  monthAfter,
  parseMoneyText,
  parseRate,
  projectInvestments,
  ruleOfDraft,
  validateRule,
} from './investment_plan.js';
import type { InvestmentPlan, PlanRule } from './investment_plan.js';

const starts = [
  { id: 'inv', name: 'Investimentos', cents: 10_000_000 },
  { id: 'res', name: 'Reserva', cents: 2_000_000 },
];

const rule = (patch: Partial<PlanRule>): PlanRule => ({
  id: 'r',
  portfolioId: 'inv',
  cents: 100_000,
  from: '2026-12',
  until: null,
  ...patch,
});

describe('projeção de investimentos', () => {
  it('meses seguidos, virando o ano', () => {
    expect(monthAfter('2026-11', 0)).toBe('2026-11');
    expect(monthAfter('2026-11', 2)).toBe('2027-01');
    expect(monthAfter('2026-12', 13)).toBe('2028-01');
  });

  it('sem regra e sem rentabilidade, nada muda', () => {
    const rows = projectInvestments(starts, EMPTY_PLAN, '2026-12', 3);
    expect(rows).toHaveLength(3);
    expect(rows[2]?.end['inv']).toBe(10_000_000);
    expect(rows[2]?.totalEnd).toBe(12_000_000);
  });

  it('aporte fixo por carteira, mês a mês', () => {
    const plan: InvestmentPlan = {
      ...EMPTY_PLAN,
      rules: [
        rule({ id: 'a', portfolioId: 'inv', cents: 700_000 }),
        rule({ id: 'b', portfolioId: 'res', cents: 300_000 }),
      ],
    };
    const rows = projectInvestments(starts, plan, '2026-12', 3);
    expect(rows[0]?.aporte).toEqual({ inv: 700_000, res: 300_000 });
    expect(rows[2]?.end['inv']).toBe(10_000_000 + 3 * 700_000);
    expect(rows[2]?.end['res']).toBe(2_000_000 + 3 * 300_000);
    expect(rows[2]?.totalAporte).toBe(1_000_000);
  });

  it('duas regras na mesma carteira somam, e a janela de meses vale', () => {
    const plan: InvestmentPlan = {
      ...EMPTY_PLAN,
      rules: [
        rule({ id: 'a', cents: 100_000 }),
        rule({ id: 'b', cents: 50_000, from: '2027-01', until: '2027-01' }),
      ],
    };
    const rows = projectInvestments(starts, plan, '2026-12', 3);
    expect(rows.map((r) => r.aporte['inv'])).toEqual([100_000, 150_000, 100_000]);
  });

  it('rentabilidade ao ano compõe mês a mês, antes do aporte do mês', () => {
    const plan: InvestmentPlan = {
      ...EMPTY_PLAN,
      rules: [rule({})],
      rates: { inv: 1200 },
    };
    const rows = projectInvestments(starts, plan, '2026-12', 12);
    const noAporte = projectInvestments(
      starts,
      { ...EMPTY_PLAN, rates: { inv: 1200 } },
      '2026-12',
      12,
    );
    // 12 meses a 12% a.a. sobre 100.000,00, sem contar aportes: ~ +12%
    expect(noAporte[11]?.end['inv']).toBeGreaterThan(11_190_000);
    expect(noAporte[11]?.end['inv']).toBeLessThan(11_210_000);
    expect(rows[0]?.rendimento['inv']).toBeGreaterThan(0);
    expect(rows[0]?.end['inv']).toBe(
      10_000_000 + (rows[0]?.rendimento['inv'] ?? 0) + 100_000,
    );
    expect(rows[11]?.totalEnd).toBe(
      (rows[11]?.end['inv'] ?? 0) + (rows[11]?.end['res'] ?? 0),
    );
  });

  it('rentabilidade com duas casas: 13,75% rende mais que 13,7%', () => {
    const run = (rate: number) =>
      projectInvestments(
        starts,
        { ...EMPTY_PLAN, rates: { inv: rate } },
        '2026-12',
        12,
      )[11]?.end['inv'] ?? 0;
    expect(run(1375)).toBeGreaterThan(run(1370));
    expect(run(1375)).toBeLessThan(run(1380));
  });
});

describe('aportes de valor fixo', () => {
  const plan: InvestmentPlan = {
    ...EMPTY_PLAN,
    rules: [
      rule({ id: 'a', portfolioId: 'inv', cents: 700_000 }),
      rule({ id: 'b', portfolioId: 'res', cents: 300_000 }),
    ],
  };

  it('cada carteira recebe o seu valor por mês', () => {
    const rows = projectInvestments(starts, plan, '2026-12', 3);
    expect(rows[0]?.aporte).toEqual({ inv: 700_000, res: 300_000 });
    expect(rows[2]?.end['inv']).toBe(10_000_000 + 3 * 700_000);
    expect(rows[2]?.end['res']).toBe(2_000_000 + 3 * 300_000);
    expect(rows[2]?.totalAporte).toBe(1_000_000);
  });

  it('regras da mesma carteira somam, e a janela de meses vale', () => {
    const more: InvestmentPlan = {
      ...plan,
      rules: [
        ...plan.rules,
        rule({
          id: 'c',
          portfolioId: 'res',
          cents: 50_000,
          from: '2027-01',
          until: '2027-01',
        }),
      ],
    };
    const rows = projectInvestments(starts, more, '2026-12', 3);
    expect(rows.map((r) => r.aporte['res'])).toEqual([300_000, 350_000, 300_000]);
  });
});

describe('formulário', () => {
  it('rentabilidade e dinheiro digitados', () => {
    expect(parseRate('13,75')).toBe(1375);
    expect(parseRate('13.75')).toBe(1375);
    expect(parseRate('12,5')).toBe(1250);
    expect(parseRate('7')).toBe(700);
    expect(parseRate('')).toBe(0);
    expect(parseRate('100')).toBe(10_000);
    expect(parseRate('100,01')).toBeNull();
    expect(parseRate('13,755')).toBeNull();
    expect(parseRate('x')).toBeNull();
    expect(formatRate(1375)).toBe('13,75');
    expect(formatRate(1250)).toBe('12,5');
    expect(formatRate(1300)).toBe('13');
    expect(formatRate(5)).toBe('0,05');
    expect(parseMoneyText('1.250,50')).toBe(125_050);
    expect(parseMoneyText('500')).toBe(50_000);
    expect(parseMoneyText('0')).toBeNull();
    expect(parseMoneyText('abc')).toBeNull();
  });

  it('valida a regra e a converte', () => {
    const draft = { portfolioId: 'inv', value: '1.000,00', from: '2026-12', until: '' };
    expect(validateRule(draft, ['inv'])).toEqual({});
    expect(ruleOfDraft(draft, 'r1')).toMatchObject({ cents: 100_000, until: null });
    expect(
      validateRule({ ...draft, portfolioId: 'x' }, ['inv']).portfolioId,
    ).toBeDefined();
    expect(validateRule({ ...draft, value: 'x' }, ['inv']).value).toBeDefined();
    expect(validateRule({ ...draft, until: '2026-01' }, ['inv']).until).toBeDefined();
  });
});
