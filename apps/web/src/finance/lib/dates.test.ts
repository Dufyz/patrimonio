import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  diffDays,
  endOfMonth,
  saoPauloDate,
  startOfMonth,
  weekdayIndex,
} from './dates.js';
import { setTodayOverride, today, todayFromSearch } from './clock.js';

describe('datas de negócio', () => {
  it('soma dias e meses, caindo no último dia de mês curto', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-10-15', -10)).toBe('2025-12-15');
    expect(addMonths('2026-10-15', 3)).toBe('2027-01-15');
  });

  it('limites do mês e distância em dias', () => {
    expect(startOfMonth('2026-10-24')).toBe('2026-10-01');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(diffDays('2026-10-24', '2026-10-30')).toBe(6);
    expect(diffDays('2026-10-30', '2026-10-24')).toBe(-6);
  });

  it('dia da semana sem depender do fuso do navegador', () => {
    expect(weekdayIndex('2026-10-21')).toBe(3);
    expect(weekdayIndex('2026-10-17')).toBe(6);
  });
});

describe('"hoje" em São Paulo', () => {
  it('à noite em São Paulo ainda é o mesmo dia, embora em UTC já seja o seguinte', () => {
    expect(saoPauloDate(new Date('2026-11-04T01:30:00Z'))).toBe('2026-11-03');
    expect(saoPauloDate(new Date('2026-11-04T03:00:00Z'))).toBe('2026-11-04');
    expect(saoPauloDate(new Date('2026-11-04T02:59:59Z'))).toBe('2026-11-03');
  });

  it('pode ser fixado, para conferir contra as pranchas', () => {
    setTodayOverride('2026-10-24');
    expect(today(new Date('2030-01-01T12:00:00Z'))).toBe('2026-10-24');
    setTodayOverride(null);
    expect(today(new Date('2026-11-04T01:30:00Z'))).toBe('2026-11-03');
  });

  it('lê ?hoje= da URL e ignora valor inválido', () => {
    expect(todayFromSearch('?hoje=2026-10-24')).toBe('2026-10-24');
    expect(todayFromSearch('?hoje=ontem')).toBeNull();
    expect(todayFromSearch('')).toBeNull();
  });
});
