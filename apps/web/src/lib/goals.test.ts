import { describe, expect, it } from 'vitest';

import {
  arrivalText,
  barState,
  decodeRates,
  encodeRates,
  monthYearLabel,
  normalizeRateInput,
  withRate,
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

  it('a taxa na URL volta como saiu e descarta par inválido', () => {
    const rates = { b: '5.5', a: '6' };
    expect(encodeRates(rates)).toBe('a:6,b:5.5');
    expect(decodeRates('a:6,b:5.5')).toEqual({ a: '6', b: '5.5' });
    expect(decodeRates('a:x,:3,b:5:1,c:7')).toEqual({ c: '7' });
    expect(decodeRates(null)).toEqual({});
    expect(encodeRates({})).toBeNull();
  });

  it('trocar e remover a taxa de um objetivo não toca nos outros', () => {
    expect(withRate({ a: '6' }, 'b', '4')).toEqual({ a: '6', b: '4' });
    expect(withRate({ a: '6', b: '4' }, 'a', null)).toEqual({ b: '4' });
  });
});
