import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_COLOR,
  CLASS_COLOR_TOKENS,
  SERIES_COLORS,
  colorForSeries,
  colorForToken,
  isClassColorToken,
} from './tokens.js';

describe('tokens de cor', () => {
  it('o token vira variável do tema, nunca um hexadecimal', () => {
    expect(colorForToken('class.acoes')).toBe('var(--color-class-acoes)');
    expect(colorForToken('class.rf-inflacao')).toBe('var(--color-class-rf-inflacao)');
  });

  it('categoria com token desconhecido ainda recebe cor', () => {
    expect(colorForToken('class.cripto')).toBe('var(--color-class-outros)');
    expect(colorForToken(null)).toBe('var(--color-class-outros)');
    expect(colorForToken('#d07f1d')).toBe('var(--color-class-outros)');
  });

  it('todo token declarado é reconhecido', () => {
    for (const token of CLASS_COLOR_TOKENS) {
      expect(isClassColorToken(token)).toBe(true);
      expect(colorForToken(token)).toBe(`var(--color-${token.replace('.', '-')})`);
    }
  });

  it('as cores de série circulam em vez de acabar', () => {
    expect(colorForSeries(0)).toBe(SERIES_COLORS[0]);
    expect(colorForSeries(SERIES_COLORS.length)).toBe(SERIES_COLORS[0]);
    expect(colorForSeries(SERIES_COLORS.length + 2)).toBe(SERIES_COLORS[2]);
  });

  it('o benchmark não divide cor com nenhuma série', () => {
    expect(SERIES_COLORS).not.toContain(BENCHMARK_COLOR);
  });
});
