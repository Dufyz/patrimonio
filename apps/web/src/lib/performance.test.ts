import type { PerformanceResource } from '@patrimonio/contracts';
import { describe, expect, it } from 'vitest';

import {
  addBenchmark,
  availableToAdd,
  benchmarkColor,
  chartSeries,
  extraBenchmarks,
  removeBenchmark,
  shortMonth,
  windowLabel,
} from './performance.js';

const CDI = { id: 'b1', name: 'CDI', kind: 'index' as const };
const IBOV = { id: 'b2', name: 'Ibovespa', kind: 'index' as const };
const IPCA = { id: 'b3', name: 'IPCA', kind: 'index' as const };

describe('rótulos', () => {
  it('o mês abreviado leva o ano de dois dígitos', () => {
    expect(shortMonth('2026-06')).toBe('jun/26');
    expect(shortMonth('2026-12-31')).toBe('dez/26');
  });

  it('mês e início carregam a data; as demais janelas só o nome', () => {
    const context = { referenceDate: '2026-09-30', inception: '2021-03-15' };

    expect(windowLabel('month', context)).toBe('SET/26');
    expect(windowLabel('inception', context)).toBe('Início · MAR/21');
    expect(windowLabel('ytd', context)).toBe('YTD');
    expect(windowLabel('12m', context)).toBe('12M');
  });

  it('sem data, mês e início perdem só o complemento', () => {
    const context = { referenceDate: null, inception: null };

    expect(windowLabel('month', context)).toBe('Mês');
    expect(windowLabel('inception', context)).toBe('Início');
  });
});

describe('cores', () => {
  it('o benchmark de referência é o tracejado escuro e os outros seguem a paleta', () => {
    expect(benchmarkColor(0)).toBe('var(--color-series-benchmark)');
    expect(benchmarkColor(1)).toBe('var(--color-series-2)');
    expect(benchmarkColor(2)).toBe('var(--color-series-3)');
  });
});

describe('a escolha de benchmarks', () => {
  it('adicionar não duplica e remover tira só o pedido', () => {
    expect(addBenchmark(['a'], 'a')).toEqual(['a']);
    expect(addBenchmark(['a'], 'b')).toEqual(['a', 'b']);
    expect(removeBenchmark(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('o de referência não sai da tela; o resto pode', () => {
    expect(extraBenchmarks([CDI, IBOV], 'b1')).toEqual([IBOV]);
    expect(extraBenchmarks([CDI], null)).toEqual([CDI]);
  });

  it('o que ainda cabe escolher é o catálogo menos o que está na tela', () => {
    expect(
      availableToAdd({
        available: [CDI, IBOV, IPCA],
        selected: [CDI, IBOV],
        primary_id: 'b1',
        gaps: [],
      }),
    ).toEqual([IPCA]);
  });
});

describe('o gráfico', () => {
  const chart: PerformanceResource['chart'] = {
    base_date: '2026-03-31',
    dates: ['2026-03-31', '2026-04-30'],
    portfolio: ['0.00', '5.00'],
    benchmarks: [{ id: 'b1', values: ['0.00', '1.50'] }],
  };

  it('percentual vira razão, e a carteira é a primeira linha', () => {
    const series = chartSeries(chart, [CDI, IBOV], 'Longo prazo');

    expect(series.map((item) => item.label)).toEqual(['Longo prazo', 'CDI']);
    expect(series[0]?.points.map((point) => point.value)).toEqual(['0.0000', '0.0500']);
    expect(series[1]?.points[1]?.value).toBe('0.0150');
  });

  it('só o benchmark de referência é tracejado', () => {
    const series = chartSeries(chart, [CDI, IBOV], 'Longo prazo');

    expect(series[1]?.dashed).toBe(true);
    expect(series[0]?.dashed).toBeUndefined();
  });

  it('benchmark sem linha na resposta não vira linha em zero', () => {
    const series = chartSeries({ ...chart, benchmarks: [] }, [CDI], 'Longo prazo');

    expect(series).toHaveLength(1);
  });
});
