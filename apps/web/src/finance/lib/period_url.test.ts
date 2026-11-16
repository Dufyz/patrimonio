import { describe, expect, it } from 'vitest';

import type { IsoDate } from './dates.js';
import { readRangeParams, writeRangeParams } from './period_url.js';

const padrao = { from: '2026-11-01' as IsoDate, to: '2026-11-30' as IsoDate };

describe('VGR-14 · período de Finanças na URL', () => {
  it('lê e escreve o intervalo', () => {
    const params = writeRangeParams(
      new URLSearchParams('q=x'),
      { from: '2026-01-01' as IsoDate, to: '2026-03-31' as IsoDate },
      padrao,
    );
    expect(params.toString()).toBe('q=x&de=2026-01-01&ate=2026-03-31');
    expect(readRangeParams(params)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
  });

  it('o padrão não suja a URL', () => {
    const params = writeRangeParams(
      new URLSearchParams('de=2026-01-01&ate=2026-03-31'),
      padrao,
      padrao,
    );
    expect(params.toString()).toBe('');
  });

  it('valor inválido ou invertido é ignorado', () => {
    expect(
      readRangeParams(new URLSearchParams('de=2026-03-01&ate=2026-01-01')),
    ).toBeNull();
    expect(readRangeParams(new URLSearchParams('de=abc&ate=2026-01-01'))).toBeNull();
    expect(readRangeParams(new URLSearchParams('de=2026-01-01'))).toBeNull();
  });
});
