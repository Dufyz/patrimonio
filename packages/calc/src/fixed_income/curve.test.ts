import { describe, expect, it } from 'vitest';

import {
  CDI_DAILY_FACTOR,
  cdbOver112,
  ipcaAwaitingRelease,
  ipcaPlusSpread,
  januaryWithHoliday,
  prefixedOneYear,
  weekdays,
} from '../__fixtures__/fixed_income/curve.js';
import {
  accrualDays,
  annualToPeriodFactor,
  curveSeries,
  curveValue,
} from './curve.js';

describe('pró-rata conta dia útil', () => {
  it('CDB a 112% do CDI num período com feriado rende cinco dias úteis, não oito', () => {
    const value = curveValue(cdbOver112);

    // De 2 a 10 de janeiro: oito dias corridos; o calendário tem o dia 4 como
    // feriado, então o período remunerado é 02, 03, 05, 08 e 09.
    expect(value.business_days).toBe(5);
    expect(value.index_factor).toBe('1.00224761');
    expect(value.gross_value).toBe('10022.48');
    expect(value.accrued_interest).toBe('22.48');
  });

  it('o mesmo CDB num calendário sem feriado rende um dia útil a mais', () => {
    const value = curveValue({
      ...cdbOver112,
      business_days: [...januaryWithHoliday, '2024-01-04'].sort(),
      index_factors: [
        ...(cdbOver112.index_factors ?? []),
        { date: '2024-01-04', daily_factor: CDI_DAILY_FACTOR },
      ],
    });

    expect(value.business_days).toBe(6);
    expect(Number(value.gross_value)).toBeGreaterThan(Number(cdbOver112.principal));
    expect(value.gross_value).not.toBe('10022.48');
  });

  it('na data de aplicação o valor é o principal, sem um dia de rendimento', () => {
    const value = curveValue({ ...cdbOver112, reference_date: '2024-01-02' });

    expect(value.business_days).toBe(0);
    expect(value.gross_value).toBe('10000.00');
    expect(value.accrued_interest).toBe('0.00');
  });

  it('referência anterior à aplicação não devolve período negativo', () => {
    const value = curveValue({ ...cdbOver112, reference_date: '2023-12-01' });

    expect(value.business_days).toBe(0);
    expect(value.gross_value).toBe('10000.00');
  });

  it('o período vai da aplicação inclusive à referência exclusive', () => {
    expect(accrualDays(januaryWithHoliday, '2024-01-02', '2024-01-10')).toEqual([
      '2024-01-02',
      '2024-01-03',
      '2024-01-05',
      '2024-01-08',
      '2024-01-09',
    ]);
  });
});

describe('prefixado e spread', () => {
  it('prefixado a 11% ao ano por 252 dias úteis vale exatamente 1,11 do principal', () => {
    const value = curveValue(prefixedOneYear);

    expect(value.business_days).toBe(252);
    expect(value.rate_factor).toBe('1.110000000');
    expect(value.gross_value).toBe('11100.00');
  });

  it('o spread compõe por dia útil, não linear: meio ano não é metade da taxa', () => {
    const half = annualToPeriodFactor('6', 126);

    // Linear daria 1,03. Composto por dia útil dá menos do que isso.
    expect(Number(half)).toBeLessThan(1.03);
    expect(half).toBe('1.029563014');
  });

  it('prefixado não usa série de índice nenhuma', () => {
    const value = curveValue({ ...prefixedOneYear, index_factors: [] });

    expect(value.index_factor).toBe('1.00000000');
    expect(value.missing_days).toEqual([]);
  });

  it('Tesouro IPCA+ combina o índice do mês com o cupom contratado', () => {
    const value = curveValue(ipcaPlusSpread);

    expect(value.business_days).toBe(21);
    expect(value.index_factor).toBe('1.00315472');
    expect(value.rate_factor).toBe('1.004867550');
    expect(value.factor).toBe('1.008037625757');
    expect(value.gross_value).toBe('10080.38');
  });
});

describe('IPCA entre duas divulgações', () => {
  it('o dia útil sem índice publicado usa a projeção e fica marcado', () => {
    const value = curveValue(ipcaAwaitingRelease);

    expect(value.projected_days).toHaveLength(6);
    expect(value.missing_days).toEqual([]);
    // Com a projeção igual ao índice que vai sair, o valor é o mesmo do cenário
    // em que a série está completa.
    expect(value.gross_value).toBe(curveValue(ipcaPlusSpread).gross_value);
  });

  it('sem projeção, o dia sem índice não rende e o buraco é reportado', () => {
    const value = curveValue({
      ...ipcaAwaitingRelease,
      projected_daily_factor: undefined,
    });

    expect(value.missing_days).toHaveLength(6);
    expect(value.projected_days).toEqual([]);
    expect(value.index_factor).toBe('1.00225236');
    expect(value.gross_value).toBe('10071.31');
  });

  it('quando o índice sai, o valor muda: a projeção não fica congelada', () => {
    const projected = curveValue({
      ...ipcaAwaitingRelease,
      projected_daily_factor: '1.000100',
    });
    const published = curveValue(ipcaPlusSpread);

    expect(projected.gross_value).not.toBe(published.gross_value);
  });
});

describe('série da curva', () => {
  const series = curveSeries({
    principal: cdbOver112.principal,
    issued_at: cdbOver112.issued_at,
    indexer: cdbOver112.indexer,
    rate: cdbOver112.rate,
    business_days: januaryWithHoliday,
    index_factors: cdbOver112.index_factors,
    from_date: '2024-01-02',
    through_date: '2024-01-12',
  });

  it('devolve uma linha por dia útil do intervalo', () => {
    expect(series.map((day) => day.reference_date)).toEqual(januaryWithHoliday);
  });

  it('acumular numa passada dá o mesmo número que recalcular cada dia do zero', () => {
    for (const day of series) {
      const direct = curveValue({ ...cdbOver112, reference_date: day.reference_date });

      expect(day.gross_value).toBe(direct.gross_value);
      expect(day.index_factor).toBe(direct.index_factor);
      expect(day.business_days).toBe(direct.business_days);
    }
  });

  it('o valor nunca recua num título pós-fixado', () => {
    const values = series.map((day) => Number(day.gross_value));

    expect(values).toEqual([...values].sort((left, right) => left - right));
  });

  it('o intervalo que começa depois da aplicação não reinicia o acumulado', () => {
    const later = curveSeries({
      principal: cdbOver112.principal,
      issued_at: cdbOver112.issued_at,
      indexer: cdbOver112.indexer,
      rate: cdbOver112.rate,
      business_days: januaryWithHoliday,
      index_factors: cdbOver112.index_factors,
      from_date: '2024-01-10',
      through_date: '2024-01-12',
    });

    expect(later[0]?.reference_date).toBe('2024-01-10');
    expect(later[0]?.gross_value).toBe('10022.48');
  });

  it('título com aplicação posterior ao intervalo não gera linha', () => {
    const none = curveSeries({
      principal: '1000.00',
      issued_at: '2024-06-01',
      indexer: 'prefixed',
      rate: '10',
      business_days: weekdays('2024-01-02', 40),
      from_date: '2024-01-02',
      through_date: '2024-02-01',
    });

    expect(none).toEqual([]);
  });
});
