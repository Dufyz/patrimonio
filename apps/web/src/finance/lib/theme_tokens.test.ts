import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CATEGORY_PALETTE, categoryColor } from './category_colors.js';

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

const darkStart = css.indexOf(":root[data-theme='dark'] {");
const lightBlock = css.slice(css.indexOf('@theme static'), darkStart);
const darkBlock = css.slice(darkStart, css.indexOf('}', darkStart));

const tokenIn = (block: string, name: string): string | null =>
  new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1] ?? null;

const luminance = (hex: string): number => {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
};

describe('tema claro e escuro de Finanças', () => {
  it('toda cor de categoria tem variante nos dois temas', () => {
    for (const { id } of CATEGORY_PALETTE) {
      expect(tokenIn(lightBlock, `cat-${id}`), `claro: ${id}`).not.toBeNull();
      expect(tokenIn(darkBlock, `cat-${id}`), `escuro: ${id}`).not.toBeNull();
    }
  });

  it('o marcador de categoria tem 3:1 contra o painel nos dois temas', () => {
    const panels = {
      light: tokenIn(lightBlock, 'panel')!,
      dark: tokenIn(darkBlock, 'panel')!,
    };
    for (const { id } of CATEGORY_PALETTE) {
      expect(
        contrast(tokenIn(lightBlock, `cat-${id}`)!, panels.light),
        `claro: ${id}`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(tokenIn(darkBlock, `cat-${id}`)!, panels.dark),
        `escuro: ${id}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('verde de receita, âmbar de fatura fechada e vermelho de variação têm contraste de texto', () => {
    const panels = {
      light: tokenIn(lightBlock, 'panel')!,
      dark: tokenIn(darkBlock, 'panel')!,
    };
    for (const token of ['positive', 'attention', 'negative']) {
      expect(
        contrast(tokenIn(lightBlock, token)!, panels.light),
        `claro: ${token}`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokenIn(darkBlock, token)!, panels.dark),
        `escuro: ${token}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('a cor de categoria resolve para o mesmo token em qualquer lugar, e a desconhecida cai em cinza', () => {
    expect(categoryColor('violet')).toBe('var(--color-cat-violet)');
    expect(categoryColor('inexistente')).toBe('var(--color-cat-gray)');
    expect(categoryColor(null)).toBe('var(--color-cat-gray)');
  });

  it('QUA-03 · todo texto de tokens atinge 4,5:1 sobre fundo, painel e painel-2 nos dois temas', () => {
    const texts = [
      'ink',
      'ink-2',
      'ink-3',
      'accent',
      'positive',
      'negative',
      'attention',
    ];
    const grounds = ['bg', 'panel', 'panel-2'];
    const failures: string[] = [];
    for (const [theme, block] of [
      ['claro', lightBlock],
      ['escuro', darkBlock],
    ] as const) {
      for (const text of texts) {
        for (const ground of grounds) {
          const a = tokenIn(block, text);
          const b = tokenIn(block, ground);
          if (a === null || b === null) continue;
          const ratio = contrast(a, b);
          if (ratio < 4.5)
            failures.push(`${theme}: ${text} sobre ${ground} = ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
