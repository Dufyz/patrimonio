import { describe, expect, it } from 'vitest';

import {
  attentionText,
  formatDate,
  growthBands,
  monthLabel,
  percentAsRatio,
} from './overview.js';

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
    { date: '2026-10-01', contributions: '8000.00', total: '9000.00', result: '1000.00' },
    { date: '2026-10-02', contributions: '8000.00', total: '10000.00', result: '2000.00' },
  ];

  it('a faixa de baixo é o aporte acumulado, a de cima vai dele até o patrimônio', () => {
    const bands = growthBands(points);

    expect(bands.contributions[0]).toEqual({
      date: '2026-10-01',
      from: '0',
      to: '8000.00',
    });
    expect(bands.result[1]).toEqual({
      date: '2026-10-02',
      from: '8000.00',
      to: '10000.00',
    });
  });

  it('prejuízo é marcado, para a faixa de cima trocar de cor em vez de sumir', () => {
    const bands = growthBands([
      { date: '2026-10-02', contributions: '9500.00', total: '8800.00', result: '-700.00' },
    ]);

    expect(bands.underwater).toBe(true);
  });

  it('série vazia não desenha faixa nenhuma', () => {
    expect(growthBands([]).dates).toEqual([]);
  });
});

describe('o vocabulário da tela', () => {
  it('a variação do mês é dita pelo nome do mês do fechamento', () => {
    expect(monthLabel('2026-10-02')).toBe('em outubro');
  });

  it('sem fechamento, o rótulo não inventa um mês', () => {
    expect(monthLabel(null)).toBe('no mês');
  });

  it('data aparece no formato do país, e ausência vira traço', () => {
    expect(formatDate('2026-10-02')).toBe('02/10/2026');
    expect(formatDate(null)).toBe('—');
  });
});

describe('o texto de cada pendência', () => {
  const item = (rule: string, payload: Record<string, unknown>) => ({
    rule_kind: rule,
    subject_id: 'a1',
    portfolio_id: null,
    payload,
    first_seen_at: '2026-10-02T12:00:00.000Z',
  });

  it('preço atrasado diz desde quando, porque é o que torna o aviso acionável', () => {
    const text = attentionText(
      item('price_stale', { ticker: 'KNRI11', last_price_date: '2026-10-03' }),
    );

    expect(text.title).toBe('Preço atrasado');
    expect(text.detail).toContain('KNRI11');
    expect(text.detail).toContain('03/10/2026');
    expect(text.action).toBe('Definir preço manual');
  });

  it('preço ausente não é preço velho: a posição vale o custo', () => {
    const text = attentionText(item('price_missing', { ticker: 'CRA2031' }));

    expect(text.title).toBe('Preço ausente');
    expect(text.detail).toContain('vale o custo');
  });

  it('evento corporativo mostra os termos detectados, para o usuário conferir', () => {
    const text = attentionText(
      item('corporate_event_pending', {
        ticker: 'ABCD3',
        kind: 'split',
        record_date: '2026-10-15',
        ratio_from: '1',
        ratio_to: '2',
      }),
    );

    expect(text.detail).toContain('1:2');
    expect(text.detail).toContain('15/10/2026');
    expect(text.detail).toContain('depois da confirmação');
  });

  it('regra sem tradução ainda não mostra o enum cru na tela', () => {
    const text = attentionText(item('goal_behind_pace', {}));

    expect(text.title).toBe('goal behind pace');
    expect(text.action).toBeNull();
  });
});
