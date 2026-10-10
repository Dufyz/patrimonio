import { describe, expect, it } from 'vitest';

import { fgcUsedPct } from './fgc.js';

describe('fgcUsedPct', () => {
  it('mede a exposição contra o teto, em pontos percentuais', () => {
    expect(fgcUsedPct('93260', '250000')).toBe('37.30');
    expect(fgcUsedPct('16500', '250000')).toBe('6.60');
  });

  it('passa de cem quando o emissor passou do limite', () => {
    expect(fgcUsedPct('300000', '250000')).toBe('120.00');
  });

  it('exposição negativa — resgate maior que a aplicação — não é percentual negativo', () => {
    expect(fgcUsedPct('-100', '250000')).toBe('0.00');
  });

  it('teto zero não divide por zero', () => {
    expect(fgcUsedPct('100', '0')).toBe('0.00');
  });

  it('não perde centavo em valores que não cabem em double', () => {
    expect(fgcUsedPct('0.01', '250000')).toBe('0.00');
    expect(fgcUsedPct('249999.99', '250000')).toBe('100.00');
  });
});
