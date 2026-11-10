import { describe, expect, it } from 'vitest';

import {
  arrivalText,
  barState,
  OTHER_ASSUMPTION,
  emptyGoalForm,
  formFromGoal,
  goalFormResult,
  parseMonthYear,
  monthYearLabel,
  normalizeRateInput,
} from './goals.js';

describe('lib/goals', () => {
  it('escreve mês e ano, e traço quando não há data', () => {
    expect(monthYearLabel('2043-03-15')).toBe('mar/2043');
    expect(monthYearLabel(null)).toBe('—');
  });

  it('chegar é uma data, "já chegou" ou "não chega" — nunca um traço', () => {
    expect(arrivalText(null, null)).toEqual({
      text: 'não chega em 100 anos',
      tone: 'negative',
    });
    expect(arrivalText(0, '2026-06-30')).toEqual({ text: 'já chegou', tone: 'positive' });
    expect(arrivalText(40, '2043-03-31').text).toBe('mar/2043');
  });

  it('a barra só conhece três estados', () => {
    expect(barState('reached')).toBe('reached');
    expect(barState('behind')).toBe('behind');
    expect(barState('overdue')).toBe('behind');
    expect(barState('on_track')).toBe('on_track');
    expect(barState('no_projection')).toBe('on_track');
  });

  it('aceita vírgula e % na taxa digitada e recusa o resto', () => {
    expect(normalizeRateInput('6,5')).toBe('6.5');
    expect(normalizeRateInput(' 6% ')).toBe('6');
    for (const bad of ['', 'abc', '-1', '101', '6.12345']) {
      expect(normalizeRateInput(bad)).toBeNull();
    }
  });

  it('a data do objetivo é mês e ano, e vale o último dia do mês', () => {
    expect(parseMonthYear('jun/2030')).toBe('2030-06-30');
    expect(parseMonthYear('06/2030')).toBe('2030-06-30');
    expect(parseMonthYear(' 2 / 2028 ')).toBe('2028-02-29');
    for (const bad of ['', 'jun', '13/2030', 'xxx/2030', '06/30', '06-2030']) {
      expect(parseMonthYear(bad)).toBeNull();
    }
  });

  it('o formulário de um objetivo guardado volta como foi guardado', () => {
    const form = formFromGoal({
      name: 'Casa',
      target_amount: '180000.00',
      target_date: '2029-06-30',
      return_assumption: 'IPCA + 6%',
      amount_in_today_brl: false,
    } as never);

    expect(form).toMatchObject({
      name: 'Casa',
      amount: '180.000,00',
      date: 'jun/2029',
      assumption: 'IPCA+6',
      valuesIn: 'target',
    });
  });

  it('premissa fora da lista vai para "Outra", com o texto guardado', () => {
    const form = formFromGoal({
      name: 'Casa',
      target_amount: '1.00',
      target_date: '2029-06-30',
      return_assumption: 'IPCA+6.5',
      amount_in_today_brl: true,
    } as never);

    expect(form.assumption).toBe(OTHER_ASSUMPTION);
    expect(form.otherAssumption).toBe('IPCA+6.5');
  });

  it('o formulário vira o corpo do contrato, ou diz o erro de cada campo', () => {
    expect(goalFormResult(emptyGoalForm(), null)).toMatchObject({
      body: null,
      errors: {
        name: expect.any(String),
        amount: expect.any(String),
        date: expect.any(String),
      },
    });

    const ok = goalFormResult(
      {
        ...emptyGoalForm(),
        name: ' Casa ',
        amount: '1.234,50',
        date: 'dez/2031',
        valuesIn: 'target',
      },
      null,
    );

    expect(ok.body).toEqual({
      name: 'Casa',
      target_amount: '1234.50',
      target_date: '2031-12-31',
      return_assumption: 'IPCA+6',
      amount_in_today_brl: false,
    });
  });

  it('"Outra" sem texto é erro, e com texto segue o que foi digitado', () => {
    const base = {
      ...emptyGoalForm(),
      name: 'Casa',
      amount: '10,00',
      date: 'dez/2031',
      assumption: OTHER_ASSUMPTION,
    };

    expect(goalFormResult(base, null).errors).toHaveProperty('assumption');
    expect(
      goalFormResult({ ...base, otherAssumption: 'ipca+6,5' }, null).body
        ?.return_assumption,
    ).toBe('ipca+6,5');
  });
});
