import { describe, expect, it } from 'vitest';

import {
  comparisonRange,
  currentMonth,
  formatDate,
  formatRange,
  last12Months,
  precedingRange,
  previousMonth,
  shortcutFor,
} from './period.js';

describe('período de Finanças', () => {
  it('o padrão é o mês corrente, do dia 1 ao último dia', () => {
    expect(currentMonth('2026-10-24')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(currentMonth('2026-02-03')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('atalhos de mês anterior e últimos 12 meses', () => {
    expect(previousMonth('2026-10-24')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousMonth('2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(last12Months('2026-10-24')).toEqual({ from: '2025-11-01', to: '2026-10-31' });
  });

  it('reconhece qual atalho está ativo', () => {
    expect(shortcutFor({ from: '2026-10-01', to: '2026-10-31' }, '2026-10-24')).toBe(
      'current',
    );
    expect(
      shortcutFor({ from: '2026-10-05', to: '2026-10-31' }, '2026-10-24'),
    ).toBeNull();
  });

  it('formata dd/mm no ano corrente e dd/mm/aaaa fora dele', () => {
    expect(formatDate('2026-10-01', '2026-10-24')).toBe('01/10');
    expect(formatDate('2025-12-31', '2026-10-24')).toBe('31/12/2025');
    expect(formatRange({ from: '2026-10-01', to: '2026-10-31' }, '2026-10-24')).toBe(
      '01/10 – 31/10',
    );
  });

  it('RN-62: mês corrente compara com o mês anterior completo', () => {
    expect(comparisonRange({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  it('RN-62: intervalo livre compara com o anterior de mesma duração', () => {
    expect(precedingRange({ from: '2026-10-10', to: '2026-10-19' })).toEqual({
      from: '2026-09-30',
      to: '2026-10-09',
    });
    expect(comparisonRange({ from: '2026-10-10', to: '2026-10-19' })).toEqual({
      from: '2026-09-30',
      to: '2026-10-09',
    });
  });
});
