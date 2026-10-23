import { describe, expect, it } from 'vitest';

import { formatDate, growthBands, monthLabel, percentAsRatio } from './overview.js';

describe('o percentual da api e a razão do design system', () => {
  it('move a vírgula em vez de dividir: 35,3% vira a razão 0,353', () => {
    expect(percentAsRatio('35.30')).toBe('0.3530');
  });

  it('mantém o sinal do desvio negativo', () => {
    expect(percentAsRatio('-4.63')).toBe('-0.0463');
  });

  it('não perde casa num número que não cabe em ponto flutuante', () => {
    expect(percentAsRatio('90071992547409.93')).toBe('900719925474.0993');
  });

  it('ausência continua ausência, e não zero', () => {
    expect(percentAsRatio(null)).toBeNull();
    expect(percentAsRatio('não é número')).toBeNull();
  });
});

describe('as faixas do gráfico de evolução', () => {
  const points = [
    {
      date: '2026-10-01',
      contributions: '8000.00',
      total: '9000.00',
      result: '1000.00',
      payouts: '0.00',
      with_payouts: '9000.00',
    },
    {
      date: '2026-10-02',
      contributions: '8000.00',
      total: '10000.00',
      result: '2000.00',
      payouts: '150.00',
      with_payouts: '10150.00',
    },
  ];

  it('a faixa de baixo é o aporte acumulado, a de cima vai dele até o patrimônio', () => {
    const bands = growthBands(points);

    expect(bands.contributions[0]).toEqual({
      date: '2026-10-01',
      from: '0',
      to: '8000.00',
      amount: '8000.00',
    });
    expect(bands.result[1]).toEqual({
      date: '2026-10-02',
      from: '8000.00',
      to: '10000.00',
      amount: '2000.00',
    });
  });

  it('a faixa de cima vale o rendimento, e não o patrimônio que ela alcança', () => {
    const bands = growthBands(points);

    // Quem lê o valor da faixa (dica, legenda) precisa do rendimento acumulado:
    // o topo (`to`) é o patrimônio inteiro, aporte incluído.
    expect(bands.result[0]?.amount).toBe('1000.00');
    expect(bands.total.map((point) => point.value)).toEqual(['9000.00', '10000.00']);
  });

  it('o provento recebido é a faixa que vai do patrimônio até o patrimônio mais proventos', () => {
    const bands = growthBands(points);

    expect(bands.hasPayouts).toBe(true);
    expect(bands.payouts[1]).toEqual({
      date: '2026-10-02',
      from: '10000.00',
      to: '10150.00',
      amount: '150.00',
    });
  });

  it('sem provento nenhum a faixa não aparece', () => {
    const bands = growthBands(
      points.map((point) => ({ ...point, payouts: '0.00', with_payouts: point.total })),
    );

    expect(bands.hasPayouts).toBe(false);
  });

  it('prejuízo é marcado, para a faixa de cima trocar de cor em vez de sumir', () => {
    const bands = growthBands([
      {
        date: '2026-10-02',
        contributions: '9500.00',
        total: '8800.00',
        result: '-700.00',
        payouts: '0.00',
        with_payouts: '8800.00',
      },
    ]);

    expect(bands.underwater).toBe(true);
  });

  it('série vazia não desenha faixa nenhuma', () => {
    expect(growthBands([]).dates).toEqual([]);
  });
});

describe('o vocabulário da tela', () => {
  it('a variação do mês é dita pelo nome do mês da consolidação', () => {
    expect(monthLabel('2026-10-02')).toBe('em outubro');
  });

  it('sem consolidação, o rótulo não inventa um mês', () => {
    expect(monthLabel(null)).toBe('no mês');
  });

  it('data aparece no formato do país, e ausência vira traço', () => {
    expect(formatDate('2026-10-02')).toBe('02/10/2026');
    expect(formatDate(null)).toBe('—');
  });
});
