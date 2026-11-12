import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * TEM-04 (1) · Todo par texto/fundo declarado dos tokens atinge contraste AA nos
 * dois temas. Lê os valores de `styles.css`, a única fonte de cor, e calcula a
 * razão de contraste da WCAG 2.1. Um token translúcido é misturado sobre o fundo
 * em que de fato aparece, o painel.
 */

type Rgb = readonly [number, number, number];

const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8');

/** O conteúdo do primeiro bloco `{ ... }` depois de `opening`. */
const blockAfter = (opening: string): string => {
  const start = css.indexOf(opening);
  if (start < 0) throw new Error(`bloco não encontrado: ${opening}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  throw new Error(`bloco sem fim: ${opening}`);
};

const readTokens = (block: string): Map<string, string> => {
  const tokens = new Map<string, string>();
  for (const match of block.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
    tokens.set(match[1] ?? '', (match[2] ?? '').trim());
  }
  return tokens;
};

const light = readTokens(blockAfter('@theme static'));
// O escuro só redeclara o que muda: o resto vale o que vale no claro.
const dark = new Map([...light, ...readTokens(blockAfter(":root[data-theme='dark']"))]);

const parseColor = (value: string, over: Rgb | null): Rgb => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex !== null) {
    const n = parseInt(hex[1] ?? '', 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/.exec(value);
  if (rgb !== null && over !== null) {
    const alpha = Number(rgb[4]);
    return [1, 2, 3].map((slot) =>
      Math.round(Number(rgb[slot]) * alpha + (over[slot - 1] ?? 0) * (1 - alpha)),
    ) as unknown as Rgb;
  }
  throw new Error(`cor não suportada: ${value}`);
};

const luminance = ([r, g, b]: Rgb): number => {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** [texto, fundo, mínimo]. 4,5 para texto comum; o resto está nas pontas do par. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ['ink', 'bg', 4.5],
  ['ink', 'panel', 4.5],
  ['ink-2', 'panel', 4.5],
  ['ink-3', 'panel', 4.5],
  ['accent', 'panel', 4.5],
  ['btn-ink', 'btn', 4.5],
  ['seg-active-ink', 'seg-active', 4.5],
  ['positive', 'panel', 4.5],
  ['negative', 'panel', 4.5],
  ['attention', 'panel', 4.5],
  ['positive', 'positive-soft', 4.5],
  ['negative', 'negative-soft', 4.5],
  ['attention', 'attention-soft', 4.5],
  ['type-buy-ink', 'type-buy', 4.5],
  ['type-sell-ink', 'type-sell', 4.5],
  ['type-income-ink', 'type-income', 4.5],
  ['type-cash-ink', 'type-cash', 4.5],
];

describe.each([
  ['claro', light],
  ['escuro', dark],
] as const)('contraste AA · tema %s', (_name, tokens) => {
  const panel = parseColor(tokens.get('panel') ?? '', null);
  const get = (token: string): Rgb => {
    const value = tokens.get(token);
    if (value === undefined) throw new Error(`token --color-${token} não existe`);
    return parseColor(value, panel);
  };

  it.each(PAIRS)('%s sobre %s ≥ %s:1', (text, background, minimum) => {
    const found = ratio(get(text), get(background));
    expect(
      found,
      `${text} sobre ${background}: ${found.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(minimum);
  });
});
