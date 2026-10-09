import { describe, expect, it } from 'vitest';

import { onePercentDaily, quotaPoints } from '../__fixtures__/performance/periods.js';
import {
  benchmarkCumulative,
  benchmarkPeriodReturn,
  cumulativeReturns,
  datesBetween,
  measurementCalendar,
  yearReturns,
} from './periods.js';
import type { BenchmarkSpec } from './periods.js';

const calendar = [
  '2025-03-03',
  '2025-03-04',
  '2025-03-05',
  '2025-03-06',
  '2025-03-07',
] as const;

const spec: BenchmarkSpec = {
  definition: { kind: 'index', index: 'IDX' },
  factors: onePercentDaily,
  calendar,
};

describe('o calendário de medição', () => {
  it('une os dias da carteira com os dias de índice, sem repetir e em ordem', () => {
    const merged = measurementCalendar(onePercentDaily, ['2025-03-04', '2025-03-10']);

    expect(merged).toEqual([
      '2025-03-03',
      '2025-03-04',
      '2025-03-05',
      '2025-03-06',
      '2025-03-10',
    ]);
  });

  it('a base fica de fora e o fim entra', () => {
    expect(datesBetween(calendar, '2025-03-03', '2025-03-05')).toEqual([
      '2025-03-04',
      '2025-03-05',
    ]);
  });
});

describe('o retorno do benchmark entre duas datas', () => {
  it('compõe os fatores do período: quatro dias de 1% são 4,06%', () => {
    expect(benchmarkPeriodReturn(spec, '2025-02-28', '2025-03-06')).toBe('4.06');
  });

  it('não conta o fator do dia da base', () => {
    // De 03/03 a 06/03 são três dias: 1,01³ − 1.
    expect(benchmarkPeriodReturn(spec, '2025-03-03', '2025-03-06')).toBe('3.03');
  });

  it('período sem nenhum dia devolve zero, e não nulo', () => {
    expect(benchmarkPeriodReturn(spec, '2025-03-07', '2025-03-07')).toBe('0.00');
  });

  it('dia útil sem fator publicado é dia sem variação', () => {
    // 07/03 está no calendário e não tem fator: o acumulado não muda.
    expect(benchmarkPeriodReturn(spec, '2025-02-28', '2025-03-07')).toBe('4.06');
  });
});

describe('o benchmark acumulado nas datas da carteira', () => {
  it('parte de zero na base e acumula a cada data pedida', () => {
    expect(
      benchmarkCumulative(spec, '2025-03-03', ['2025-03-04', '2025-03-05', '2025-03-06']),
    ).toEqual(['1.00', '2.01', '3.03']);
  });

  it('o fator de um dia sem fechamento da carteira entra no próximo ponto', () => {
    // A carteira não fechou em 04/03: o fator do dia aparece em 05/03.
    expect(benchmarkCumulative(spec, '2025-03-03', ['2025-03-05'])).toEqual(['2.01']);
  });

  it('data antes do primeiro fator fica em zero', () => {
    expect(benchmarkCumulative(spec, '2025-02-20', ['2025-02-25'])).toEqual(['0.00']);
  });

  it('sem datas pedidas não há o que desenhar', () => {
    expect(benchmarkCumulative(spec, '2025-03-03', [])).toEqual([]);
  });
});

describe('o retorno acumulado da carteira', () => {
  it('mede cada ponto contra a cota da base', () => {
    const [base, ...rest] = quotaPoints;
    if (base === undefined) throw new Error('fixture vazia');

    expect(cumulativeReturns(rest, base)).toEqual(['5.00', '10.00', '11.10', '15.00', '21.00']);
  });
});

describe('o retorno de cada ano civil', () => {
  it('o ano é composto: 10% e 10% fazem 21% no acumulado, não 20%', () => {
    const years = yearReturns(quotaPoints);

    expect(years.map((year) => [year.year, year.return_pct])).toEqual([
      [2024, '10.00'],
      [2025, '10.00'],
    ]);
  });

  it('o primeiro ano parte do primeiro fechamento da série', () => {
    expect(yearReturns(quotaPoints)[0]).toMatchObject({
      base_date: '2024-11-29',
      end_date: '2024-12-31',
    });
  });

  it('os anos seguintes partem do último fechamento do ano anterior', () => {
    expect(yearReturns(quotaPoints)[1]).toMatchObject({
      base_date: '2024-12-31',
      end_date: '2025-12-31',
    });
  });

  it('série vazia não tem ano', () => {
    expect(yearReturns([])).toEqual([]);
  });

  it('um único fechamento é um ano de retorno zero', () => {
    expect(
      yearReturns([{ position_date: '2025-05-05', quota_value: '1.000000000000' }]),
    ).toEqual([
      {
        year: 2025,
        base_date: '2025-05-05',
        end_date: '2025-05-05',
        return_pct: '0.00',
      },
    ]);
  });
});
