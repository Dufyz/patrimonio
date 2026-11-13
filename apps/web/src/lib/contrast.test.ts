import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * NAV-15 · TEM-04 · A casca e os papéis de texto atingem contraste AA (4,5:1)
 * nos dois temas. O teste lê o `styles.css` de verdade: trocar um token que
 * quebra o contraste falha aqui, antes de qualquer revisão visual.
 */
const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

const block = (selector: string): string => {
  const start = css.indexOf(selector);
  return css.slice(start, css.indexOf('\n}', start));
};

const tokens = (text: string): Map<string, string> =>
  new Map(
    [...text.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/gu)].map(
      (match) => [match[1] ?? '', (match[2] ?? '').toLowerCase()] as const,
    ),
  );

/** `rgb(76 183 130 / 0.12)` sobre o painel vira o hexadecimal opaco que o olho vê. */
const blended = (text: string, base: Map<string, string>): Map<string, string> => {
  const panel = base.get('--color-panel') ?? '#ffffff';
  const mix = (top: number, bottom: number, alpha: number): number =>
    Math.round(top * alpha + bottom * (1 - alpha));
  const hex = (value: number): string => value.toString(16).padStart(2, '0');

  return new Map(
    [
      ...text.matchAll(/(--color-[\w-]+):\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)\s*;/gu),
    ].map((match) => {
      const alpha = Number(match[5]);
      const channels = [match[2], match[3], match[4]].map((value, index) =>
        mix(
          Number(value),
          Number.parseInt(panel.slice(1 + index * 2, 3 + index * 2), 16),
          alpha,
        ),
      );
      return [match[1] ?? '', `#${channels.map(hex).join('')}`] as const;
    }),
  );
};

const light = tokens(block('@theme'));
const darkBlock = block(":root[data-theme='dark']");
const darkBase = new Map([...light, ...tokens(darkBlock)]);
const dark = new Map([...darkBase, ...blended(darkBlock, darkBase)]);

const channel = (value: number): number => {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number => {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const ratio = (foreground: string, background: string): number => {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
  return ((a ?? 0) + 0.05) / ((b ?? 0) + 0.05);
};

/** Texto sobre fundo: o que a casca, a barra, a busca e o cabeçalho usam. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--color-ink', '--color-bg'],
  ['--color-ink', '--color-panel'],
  ['--color-ink', '--color-panel-2'],
  ['--color-ink-2', '--color-panel'],
  ['--color-ink-3', '--color-panel'],
  ['--color-ink', '--color-nav-active'],
  ['--color-seg-active-ink', '--color-seg-active'],
  ['--color-accent-ink', '--color-btn'],
  ['--color-accent', '--color-panel'],
  ['--color-positive', '--color-panel'],
  ['--color-negative', '--color-panel'],
  ['--color-attention', '--color-panel'],
  ['--color-positive', '--color-positive-soft'],
  ['--color-negative', '--color-negative-soft'],
  ['--color-attention', '--color-attention-soft'],
];

describe.each([
  ['claro', light],
  ['escuro', dark],
] as const)('contraste AA no tema %s', (_name, theme) => {
  it.each(PAIRS)('%s sobre %s passa de 4,5:1', (foreground, background) => {
    const fg = theme.get(foreground);
    const bg = theme.get(background);
    expect(fg, foreground).toBeDefined();
    expect(bg, background).toBeDefined();
    expect(ratio(fg ?? '#000000', bg ?? '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('a casca usa só tokens (NAV-15)', () => {
  it.each([
    'components/shell.tsx',
    'components/search_palette.tsx',
    'finance/components/screen_header.tsx',
  ])('%s não tem cor fixa', (file) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    expect(/#[0-9a-fA-F]{3,8}\b/u.test(source), 'hexadecimal').toBe(false);
    expect(/\b(?:bg|text|border)-(?:white|black|gray|slate|zinc)\b/u.test(source)).toBe(
      false,
    );
  });
});
