import { describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  addMonths,
  calendarDaysBetween,
  monthOf,
  monthStart,
  monthsBetween,
} from './dates.js';

describe('dias corridos', () => {
  it('conta a diferença em dias, com sinal', () => {
    expect(calendarDaysBetween('2024-01-02', '2024-07-01')).toBe(181);
    expect(calendarDaysBetween('2024-07-01', '2024-01-02')).toBe(-181);
    expect(calendarDaysBetween('2024-01-02', '2024-01-02')).toBe(0);
  });

  it('o ano bissexto é contado como ele é', () => {
    expect(calendarDaysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(calendarDaysBetween('2023-02-28', '2023-03-01')).toBe(1);
  });

  it('o horário de verão não desloca a conta: a aritmética é em UTC', () => {
    // Em fuso local, atravessar a virada de outubro daria 364 ou 366 dias.
    expect(calendarDaysBetween('2017-10-01', '2018-10-01')).toBe(365);
  });

  it('somar dias atravessa mês e ano', () => {
    expect(addCalendarDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addCalendarDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addCalendarDays('2024-01-01', -1)).toBe('2023-12-31');
  });
});

describe('meses', () => {
  it('somar meses mantém o dia', () => {
    expect(addMonths('2026-01-15', 3)).toBe('2026-04-15');
    expect(addMonths('2026-01-15', -3)).toBe('2025-10-15');
    expect(addMonths('2026-01-15', 0)).toBe('2026-01-15');
  });

  it('o mês mais curto recua o dia em vez de pular para o seguinte', () => {
    // 31 de janeiro mais um mês é 28 de fevereiro, não 3 de março.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('somar doze meses atravessa o ano', () => {
    expect(addMonths('2026-05-10', 12)).toBe('2027-05-10');
    expect(addMonths('2026-05-10', -24)).toBe('2024-05-10');
  });

  it('meses cheios: 15 de janeiro a 10 de março são dois meses, não três', () => {
    expect(monthsBetween('2026-01-15', '2026-03-10')).toBe(1);
    expect(monthsBetween('2026-01-15', '2026-03-15')).toBe(2);
    expect(monthsBetween('2026-01-15', '2026-03-20')).toBe(2);
    expect(monthsBetween('2026-01-01', '2036-01-01')).toBe(120);
  });

  it('período invertido devolve número negativo, não zero', () => {
    expect(monthsBetween('2026-03-01', '2026-01-01')).toBe(-2);
  });

  it('o mês e o começo dele saem da própria string', () => {
    expect(monthOf('2026-04-30')).toBe('2026-04');
    expect(monthStart('2026-04-30')).toBe('2026-04-01');
  });
});
