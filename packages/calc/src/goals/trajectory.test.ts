import { describe, expect, it } from 'vitest';

import { projectGoal } from './projection.js';
import {
  contributionLadder,
  expectedProgress,
  factorToPct,
  goalStanding,
  goalTrajectory,
  nominalRate,
  normalizeRate,
  parseReturnAssumption,
} from './trajectory.js';

/**
 * O cenário da prancha `10 · Objetivos`: R$ 1,5 mi em reais de hoje, retorno de
 * 6% acima da inflação, R$ 318.904 hoje e aporte médio de R$ 2.133.
 */
const independence = {
  reference_date: '2026-10-09',
  current_value: '318904.00',
  target_amount: '1500000.00',
  target_date: '2040-01-01',
  amount_in_today_brl: false,
  annual_return_pct: '6',
  monthly_contribution: '2133.00',
} as const;

describe('a premissa que o usuário escreveu', () => {
  it.each([
    ['IPCA+6', 'ipca_plus', '6.00'],
    ['IPCA + 6%', 'ipca_plus', '6.00'],
    ['ipca+6,5', 'ipca_plus', '6.50'],
    ['IPCA', 'ipca_plus', '0.00'],
    ['6', 'fixed', '6.00'],
    ['6,5% a.a.', 'fixed', '6.50'],
    ['  12 %  ', 'fixed', '12.00'],
  ])('%s é lida como %s %s', (text, kind, rate) => {
    expect(parseReturnAssumption(text)).toEqual({ kind, rate_pct: rate });
  });

  it.each(['', 'CDI+2', 'seis por cento', 'IPCA-6', '6%%x', '-3'])(
    '%j não é entendida: a tela diz isso em vez de adivinhar',
    (text) => {
      expect(parseReturnAssumption(text)).toBeNull();
    },
  );

  it('sem premissa guardada não há taxa', () => {
    expect(parseReturnAssumption(null)).toBeNull();
  });

  it('a taxa nominal é composta, e não a soma da real com a inflação', () => {
    // 1,06 × 1,045 = 1,1077; somar daria 10,5% e subestimaria o retorno.
    expect(nominalRate('6', '4.5')).toBe('10.7700');
  });
});

describe('onde o objetivo está hoje', () => {
  it('é o valor contra a meta de hoje, e o que falta é a diferença', () => {
    expect(goalStanding('318904.00', '1500000.00')).toEqual({
      progress_pct: '21.26',
      remaining_brl: '1181096.00',
      surplus_brl: null,
    });
  });

  it('a barra para em 100% e o excedente vira valor', () => {
    expect(goalStanding('1052410.00', '1000000.00')).toEqual({
      progress_pct: '100.00',
      remaining_brl: '0.00',
      surplus_brl: '52410.00',
    });
  });

  it('sem nada guardado o progresso é zero, não vazio', () => {
    expect(goalStanding('0.00', '12000.00').progress_pct).toBe('0.00');
  });
});

describe('onde deveria estar hoje', () => {
  const expected = (overrides: Record<string, string> = {}): string | null =>
    expectedProgress({
      start_date: '2025-10-09',
      start_value: '200000.00',
      reference_date: '2026-10-09',
      target_amount: '1500000.00',
      target_date: '2040-01-01',
      annual_return_pct: '6',
      ...overrides,
    });

  it('é o plano aplicado desde o começo, em % da meta', () => {
    expect(expected()).toBe('17.39');
  });

  it('com o ponto de partida mais alto, o esperado também sobe', () => {
    expect(Number(expected({ start_value: '300000.00' }))).toBeGreaterThan(
      Number(expected()),
    );
  });

  it('um objetivo que começou hoje não tem o que medir', () => {
    expect(expected({ start_date: '2026-10-09' })).toBeNull();
  });

  it('com o prazo vencido no começo, o esperado é a meta inteira', () => {
    expect(expected({ target_date: '2025-06-01' })).toBe('100.00');
  });

  it('nunca passa de 100%', () => {
    expect(expected({ start_value: '1400000.00', target_date: '2026-11-01' })).toBe(
      '100.00',
    );
  });
});

describe('a trajetória', () => {
  const months = projectGoal(independence).months_remaining;
  const trajectory = goalTrajectory({
    current_value: independence.current_value,
    monthly_contribution: independence.monthly_contribution,
    annual_return_pct: independence.annual_return_pct,
    months,
  });

  it('tem um ponto por mês e o primeiro é hoje', () => {
    expect(trajectory).toHaveLength(months + 1);
    expect(trajectory[0]).toBe('318904.00');
  });

  it('termina exatamente onde a projeção diz que o ritmo chega', () => {
    expect(trajectory.at(-1)).toBe(projectGoal(independence).projected_amount);
  });

  it('sem retorno e sem patrimônio é só a soma dos aportes', () => {
    expect(
      goalTrajectory({
        current_value: '0.00',
        monthly_contribution: '100.00',
        annual_return_pct: '0',
        months: 3,
      }),
    ).toEqual(['0.00', '100.00', '200.00', '300.00']);
  });

  it('o prazo que já passou ainda devolve o ponto de hoje', () => {
    expect(
      goalTrajectory({
        current_value: '10.00',
        monthly_contribution: '1.00',
        annual_return_pct: '0',
        months: -2,
      }),
    ).toEqual(['10.00']);
  });

  it('aportando o necessário, a trajetória fecha a meta na data', () => {
    const required = projectGoal(independence).required_monthly;
    const needed = goalTrajectory({
      current_value: independence.current_value,
      monthly_contribution: required,
      annual_return_pct: independence.annual_return_pct,
      months,
    });

    // O aporte necessário é arredondado para cima: o último ponto passa da meta.
    expect(Number(needed.at(-1))).toBeGreaterThanOrEqual(1_500_000);
    expect(Number(needed.at(-1))).toBeLessThan(1_500_100);
  });
});

describe('a tabela de aportes', () => {
  it('põe o ritmo, o necessário e dois valores redondos, em ordem', () => {
    expect(contributionLadder('2133.00', '3430.67')).toEqual([
      { amount: '2133.00', kind: 'current' },
      { amount: '3000.00', kind: 'option' },
      { amount: '3430.67', kind: 'required' },
      { amount: '4500.00', kind: 'option' },
    ]);
  });

  it('quem já está no caminho vê o ritmo e o que bastaria', () => {
    expect(contributionLadder('4000.00', '3000.00')).toEqual([
      { amount: '3000.00', kind: 'required' },
      { amount: '4000.00', kind: 'current' },
    ]);
  });

  it('sem nada a aportar, só o ritmo', () => {
    expect(contributionLadder('0.00', '0.00')).toEqual([
      { amount: '0.00', kind: 'current' },
    ]);
  });

  it('valor redondo colado em outro não vira uma escolha a mais', () => {
    // 3.950 × 1,25 = 4.937,50 → 5.000; e a média de 3.100 e 3.950 → 3.500.
    const ladder = contributionLadder('3100.00', '3950.00');

    expect(ladder.map((entry) => entry.amount)).toEqual([
      '3100.00',
      '3500.00',
      '3950.00',
      '5000.00',
    ]);
  });

  it('ritmo igual ao necessário não duplica a linha', () => {
    expect(contributionLadder('3000.00', '3000.00')).toEqual([
      { amount: '3000.00', kind: 'current' },
    ]);
  });

  it('sem aporte nenhum, o primeiro degrau é um valor redondo abaixo do necessário', () => {
    const ladder = contributionLadder('0.00', '3430.67');

    expect(ladder.map((entry) => entry.kind)).toEqual([
      'current',
      'option',
      'required',
      'option',
    ]);
    expect(ladder[1]?.amount).toBe('1500.00');
  });
});

describe('taxas e fatores', () => {
  it('a taxa ganha duas casas, e nenhuma além do que foi escolhido', () => {
    expect(normalizeRate('6')).toBe('6.00');
    expect(normalizeRate('10.77')).toBe('10.77');
    expect(normalizeRate('6.125')).toBe('6.125');
    expect(normalizeRate('6.123456')).toBe('6.1235');
  });

  it('o fator acumulado vira percentual', () => {
    expect(factorToPct('1.0451')).toBe('4.51');
    expect(factorToPct('1')).toBe('0.00');
  });
});
