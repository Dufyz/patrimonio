import { describe, expect, it } from 'vitest';

import {
  allocatePercentTenths,
  formatBRL,
  formatChangePercent,
  formatDay,
  formatDayHeader,
  formatDayOfMonth,
  formatMonth,
  formatPercentTenths,
  formatSignedBRL,
  parseMoneyInput,
} from './format.js';
import { sum } from './money.js';

describe('moeda', () => {
  it('formato brasileiro, milhar por ponto e decimal por vírgula', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatBRL(100000000)).toBe('R$ 1.000.000,00');
  });

  it('despesa com − tipográfico, receita com +', () => {
    expect(formatSignedBRL(-450000)).toBe('−R$ 4.500,00');
    expect(formatSignedBRL(35000)).toBe('+R$ 350,00');
    expect(formatSignedBRL(0)).toBe('R$ 0,00');
    expect(formatSignedBRL(-1)).toContain('−');
  });

  it('a soma de uma lista exibida é igual ao total exibido, sem diferença de centavo', () => {
    const lines = [4500_00, 3562_40, 905_80, 454_00, 55_90];
    expect(formatBRL(sum(lines))).toBe('R$ 9.478,10');
    expect(sum(lines.map((line) => line * 1))).toBe(947810);
  });

  it('lê texto de campo de dinheiro', () => {
    expect(parseMoneyInput('1.234,56')).toBe(123456);
    expect(parseMoneyInput('R$ 312,4')).toBe(31240);
    expect(parseMoneyInput('150')).toBe(15000);
    expect(parseMoneyInput('abc')).toBeNull();
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('1.23')).toBeNull();
  });
});

describe('datas', () => {
  it('dd/mm dentro do ano corrente e dd/mm/aaaa fora dele', () => {
    expect(formatDay('2026-10-21', '2026-10-24')).toBe('21/10');
    expect(formatDay('2025-12-31', '2026-10-24')).toBe('31/12/2025');
  });

  it('cabeçalho de dia e mês', () => {
    expect(formatDayHeader('2026-10-21', '2026-10-24')).toBe('Quarta, 21/10');
    expect(formatDayHeader('2026-10-17', '2026-10-24')).toBe('Sábado, 17/10');
    expect(formatMonth('2026-10-24')).toBe('out/2026');
    expect(formatDayOfMonth('2026-10-24')).toBe('dia 24 de 31');
    expect(formatDayOfMonth('2026-02-10')).toBe('dia 10 de 28');
  });
});

describe('percentuais', () => {
  it('RN-64: uma casa decimal, ajustados para somar 100%', () => {
    const tenths = allocatePercentTenths([450000, 356240, 90580, 45400, 5590]);
    expect(tenths.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(tenths.map(formatPercentTenths)).toEqual([
      '47,5%',
      '37,6%',
      '9,5%',
      '4,8%',
      '0,6%',
    ]);
  });

  it('partes iguais e lista vazia ou zerada', () => {
    const thirds = allocatePercentTenths([1, 1, 1]);
    expect(thirds.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(allocatePercentTenths([0, 0])).toEqual([0, 0]);
    expect(allocatePercentTenths([])).toEqual([]);
  });

  it('variação inteira com sinal', () => {
    expect(formatChangePercent(450000, 680000)).toBe('−34%');
    expect(formatChangePercent(356240, 356000)).toBe('+0%');
    expect(formatChangePercent(100, 0)).toBeNull();
    expect(formatChangePercent(150, 100)).toBe('+50%');
  });
});
