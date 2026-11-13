import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** CRT-12 · Cartões, Cartão e Fatura usam só tokens: barra de limite, badges e linhas. */
const dir = __dirname;
const sources = readdirSync(dir).filter(
  (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'),
);
const css = readFileSync(join(dir, '..', '..', 'styles.css'), 'utf8');

const FIXED_COLOR =
  /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:bg|text|border)-(?:white|black|slate|gray|zinc|red|green|blue)\b/;

describe('cartões em tema escuro', () => {
  it.each(sources)('%s não tem cor fixa e só usa variáveis que existem', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    expect(FIXED_COLOR.test(text)).toBe(false);
    for (const [, name] of text.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
      expect(css.includes(`${name}:`)).toBe(true);
    }
  });

  it('as cores de barra e badge existem como tokens', () => {
    for (const token of ['--color-accent', '--color-negative', '--color-panel-2']) {
      expect(css.includes(`${token}:`)).toBe(true);
    }
  });
});
