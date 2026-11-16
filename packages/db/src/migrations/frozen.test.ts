import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import frozen from './frozen.json' with { type: 'json' };

/**
 * Migration aplicada nunca é editada: o banco de quem já rodou recusa a mudança
 * de checksum. Este teste congela as migrations existentes; mudar o schema é
 * criar uma migration nova (e então acrescentá-la a `frozen.json`).
 */
describe('migrations congeladas', () => {
  it.each(Object.entries(frozen))('%s não mudou', (file, digest) => {
    const content = readFileSync(join(import.meta.dirname, file));
    expect(createHash('sha256').update(content).digest('hex')).toBe(digest);
  });
});
