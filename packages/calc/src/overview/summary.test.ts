import { describe, expect, it } from 'vitest';

import { fourDays, fromEmpty, underwater } from '../__fixtures__/overview/days.js';
import { growthSeries, periodFlows, valueChange, weighByValue } from './summary.js';

describe('a variação do cabeçalho', () => {
  it('sai em dinheiro e em proporção, contra o fechamento anterior', () => {
    expect(valueChange('101000.00', '105900.00')).toEqual({
      amount: '4900.00',
      ratio: '4.85',
    });
  });

  it('é negativa quando o patrimônio caiu, com o sinal no número', () => {
    expect(valueChange('105900.00', '101000.00')).toEqual({
      amount: '-4900.00',
      ratio: '-4.63',
    });
  });

  it('não inventa proporção quando a base é zero: a carteira começou vazia', () => {
    const [previous, current] = fromEmpty;

    expect(valueChange(previous?.total_value ?? null, current?.total_value ?? null)).toEqual(
      { amount: '1000.00', ratio: null },
    );
  });

  it('sem fechamento anterior não há variação, e isso não é zero', () => {
    expect(valueChange(null, '105900.00')).toBeNull();
    expect(valueChange('105900.00', null)).toBeNull();
  });
});

describe('os fluxos da janela', () => {
  it('somam aporte, rendimento e provento da série inteira', () => {
    expect(periodFlows(fourDays)).toEqual({
      contributions: '5000.00',
      income: '900.00',
      payouts: '150.00',
    });
  });

  it('janela sem dia nenhum soma zero, e zero é um número', () => {
    expect(periodFlows([])).toEqual({
      contributions: '0.00',
      income: '0.00',
      payouts: '0.00',
    });
  });

  it('separa o que entrou do que rendeu no dia em que houve os dois', () => {
    const day = fourDays[2];

    expect(periodFlows(day === undefined ? [] : [day])).toEqual({
      contributions: '5000.00',
      income: '-500.00',
      payouts: '0.00',
    });
  });
});

describe('as faixas do gráfico de evolução', () => {
  it('a faixa de cima é a diferença entre o patrimônio e o aporte acumulado', () => {
    expect(growthSeries(fourDays).at(-1)).toEqual({
      date: '2026-10-02',
      contributions: '95000.00',
      total: '105900.00',
      result: '10900.00',
    });
  });

  it('prejuízo aparece como resultado negativo, não como faixa cortada em zero', () => {
    expect(growthSeries(underwater)).toEqual([
      {
        date: '2026-10-02',
        contributions: '95000.00',
        total: '88000.00',
        result: '-7000.00',
      },
    ]);
  });
});

describe('o peso de cada posição', () => {
  const positions = [
    { id: 'a', label: 'ITUB4', value: '18420.00' },
    { id: 'b', label: 'Tesouro IPCA+ 2035', value: '52310.40' },
    { id: 'c', label: 'HGLG11', value: '18420.00' },
  ];

  it('ordena pelo valor, maior primeiro', () => {
    expect(weighByValue(positions, '318904.12').map((row) => row.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('empate de valor desempata pelo rótulo, para a ordem não dançar entre cargas', () => {
    const [, second, third] = weighByValue(positions, '318904.12');

    expect([second?.label, third?.label]).toEqual(['HGLG11', 'ITUB4']);
  });

  it('o peso é a fatia do total do escopo, com duas casas', () => {
    const [first] = weighByValue(positions, '318904.12');

    expect(first?.weight_pct).toBe('16.40');
  });

  it('total zero não vira divisão por zero: o peso é zero', () => {
    expect(weighByValue(positions, '0.00').map((row) => row.weight_pct)).toEqual([
      '0.00',
      '0.00',
      '0.00',
    ]);
  });
});
