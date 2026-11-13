import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * LAN-20 · A tela e os modais do livro usam só tokens: nenhuma cor fixa, que
 * ficaria igual nos dois temas.
 */
const dir = __dirname;
const sources = readdirSync(dir).filter(
  (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'),
);

const FIXED_COLOR =
  /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:bg|text|border)-(?:white|black|slate|gray|zinc|red|green|blue)\b/;

describe('livro em tema escuro', () => {
  it.each(sources)('%s não tem cor fixa', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    expect(FIXED_COLOR.test(text)).toBe(false);
  });
});
