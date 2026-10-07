import { describe, expect, it } from 'vitest';

import {
  addDays,
  compareDateOnly,
  isDateOnly,
  minDateOnly,
  toDateOnly,
} from './date_only.js';

describe('data de negócio', () => {
  it('reconhece YYYY-MM-DD e recusa o resto', () => {
    expect(isDateOnly('2024-03-10')).toBe(true);
    expect(isDateOnly('10/03/2024')).toBe(false);
    expect(isDateOnly('2024-13-10')).toBe(false);
    expect(isDateOnly(new Date())).toBe(false);
  });

  it('a conversão não desloca o dia, que é o erro clássico de fuso', () => {
    // 00:00 em São Paulo é 03:00 UTC do mesmo dia: o dia não pode recuar.
    expect(toDateOnly('2024-03-10T00:00:00-03:00')).toBe('2024-03-10');
    expect(toDateOnly('2024-03-10')).toBe('2024-03-10');
    expect(toDateOnly(new Date('2024-03-10T12:00:00.000Z'))).toBe('2024-03-10');
  });

  it('data inválida estoura em vez de virar NaN silencioso', () => {
    expect(() => toDateOnly('ontem')).toThrow(/data inválida/);
  });

  it('somar dias atravessa mês, ano e 29 de fevereiro', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
  });

  it('comparação e mínimo funcionam sobre a string', () => {
    expect(compareDateOnly('2024-01-01', '2024-02-01')).toBe(-1);
    expect(compareDateOnly('2024-02-01', '2024-01-01')).toBe(1);
    expect(compareDateOnly('2024-01-01', '2024-01-01')).toBe(0);
    expect(minDateOnly('2021-03-12', '2024-01-01')).toBe('2021-03-12');
  });
});
