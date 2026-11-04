import { describe, expect, it } from 'vitest';

import { limitTone, usedPercent } from './limit.js';

describe('barra de limite', () => {
  it('reproduz os percentuais das pranchas', () => {
    expect(usedPercent(348217, 566000)).toBe(61.5);
    expect(usedPercent(398217, 566000)).toBe(70.4);
  });

  it('verde até 70%, âmbar de 70% a 90%, vermelho acima', () => {
    expect(limitTone(61.5)).toBe('ok');
    expect(limitTone(70)).toBe('ok');
    expect(limitTone(70.4)).toBe('warn');
    expect(limitTone(90)).toBe('warn');
    expect(limitTone(90.1)).toBe('high');
  });

  it('limite zero não divide por zero', () => {
    expect(usedPercent(100, 0)).toBe(0);
  });
});
