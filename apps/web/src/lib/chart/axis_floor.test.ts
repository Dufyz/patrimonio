import { describe, expect, it } from 'vitest';

import { axisFloor, domainOf, formatAxisFloor } from './scale.js';

describe('piso do eixo (prancha 1: "eixo a partir de R$ 100k")', () => {
  it('118k a 195k começa em 100k', () => {
    expect(axisFloor([118_000, 150_000, 195_000])).toBe(100_000);
  });

  it('série que toca o zero, constante ou vazia não tem piso', () => {
    expect(axisFloor([0, 50_000])).toBe(0);
    expect(axisFloor([40_000, 40_000])).toBe(0);
    expect(axisFloor([])).toBe(0);
  });

  it('o piso nunca passa do menor valor', () => {
    const values = [78_300, 100_000, 140_279];
    expect(axisFloor(values)).toBeLessThanOrEqual(Math.min(...values));
    expect(axisFloor(values)).toBeGreaterThan(0);
  });

  it('o domínio parte do piso e deixa folga só em cima', () => {
    const [low, high] = domainOf([118_000, 195_000], { floor: 100_000 });
    expect(low).toBe(100_000);
    expect(high).toBeGreaterThan(195_000);
  });

  it('um piso acima do menor valor é ignorado: o gráfico não corta dado', () => {
    const [low] = domainOf([90_000, 195_000], { floor: 100_000 });
    expect(low).toBeLessThan(90_000);
  });

  it('o rótulo do cabeçalho: R$ 100k, R$ 12,5k, R$ 500', () => {
    expect(formatAxisFloor(100_000)).toBe('R$ 100k');
    expect(formatAxisFloor(12_500)).toBe('R$ 12,5k');
    expect(formatAxisFloor(500)).toBe('R$ 500');
  });
});
