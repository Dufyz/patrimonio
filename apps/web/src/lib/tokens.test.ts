import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_COLOR,
  CLASS_COLOR_TOKENS,
  SERIES_COLORS,
  colorForPortfolio,
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

describe('cores de dados por variáveis (TEM-03)', () => {
  it('a carteira recebe a cor de série pela ordem de Configurações', () => {
    const ordem = ['a', 'b', 'c'];
    expect(colorForPortfolio('a', ordem)).toBe(colorForSeries(0));
    expect(colorForPortfolio('c', ordem)).toBe(colorForSeries(2));
    // Reordenar em Configurações troca a cor, e só ali.
    expect(colorForPortfolio('c', ['c', 'a', 'b'])).toBe(colorForSeries(0));
  });

  const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
  const block = (selector: string): string => {
    const start = css.indexOf(selector);
    return css.slice(start, css.indexOf('\n}', start));
  };
  const names = (text: string): Set<string> =>
    new Set(
      [...text.matchAll(/(--color-(?:class|series|cat|area|planned)[\w-]*):/gu)].map(
        (m) => m[1] ?? '',
      ),
    );

  it('o tema escuro troca os valores sem mudar o mapeamento: mesmos nomes nos dois', () => {
    const light = names(block('@theme'));
    const dark = names(block(":root[data-theme='dark']"));
    expect(light.size).toBeGreaterThan(20);
    for (const name of light) expect(dark.has(name), name).toBe(true);
  });

  it('nenhum gráfico usa pizza ou donut', () => {
    const root = join(__dirname, '..');
    const sources = ['components', 'views'].flatMap((dir) =>
      readdirSync(join(root, dir))
        .filter((file) => /\.tsx$/u.test(file) && !file.includes('.test.'))
        .map((file) => [file, readFileSync(join(root, dir, file), 'utf8')] as const),
    );
    for (const [file, source] of sources) {
      if (file === 'gallery.tsx') continue;
      expect(/<Pie|PieChart|innerRadius|donut\(/iu.test(source), file).toBe(false);
    }
  });
});
