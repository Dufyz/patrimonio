import { describe, expect, it } from 'vitest';

import { DEFAULT_PERIOD, windowLabel } from './period.js';

describe('nome da janela no cabeçalho dos painéis', () => {
  it('o padrão é "últimos 12 meses", como nas pranchas', () => {
    expect(windowLabel(DEFAULT_PERIOD)).toBe('últimos 12 meses');
  });

  it('presets e intervalo personalizado', () => {
    expect(windowLabel({ kind: 'preset', preset: 'ytd' })).toBe('no ano');
    expect(windowLabel({ kind: 'preset', preset: 'inicio' })).toBe('desde o início');
    expect(windowLabel({ kind: 'custom', from: '2026-01-01', to: '2026-02-01' })).toBe(
      'período escolhido',
    );
  });
});
