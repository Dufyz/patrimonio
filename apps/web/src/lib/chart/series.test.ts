import { describe, expect, it } from 'vitest';

import { domainOf, linearScale, niceTicks, toNumber, toPercentNumber } from './scale.js';
import type { Point } from './series.js';
import { downsample, nearestIndex, splitSegments, tooltipSide } from './series.js';

const point = (date: string, value: string | null): Point => ({ date, value });

describe('escala', () => {
  it('as marcas do eixo são números redondos', () => {
    expect(niceTicks(0, 318904)).toEqual([0, 100000, 200000, 300000]);
    expect(niceTicks(0, 0.32, 4)).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it('o eixo não inventa casas de ponto flutuante', () => {
    expect(niceTicks(0, 1, 5).every((tick) => String(tick).length <= 4)).toBe(true);
  });

  it('série constante desenha no meio em vez de dividir por zero', () => {
    const scale = linearScale([5, 5], [100, 0]);
    expect(scale(5)).toBe(50);
  });

  it('área empilhada começa em zero', () => {
    expect(domainOf([200000, 318904], { fromZero: true })[0]).toBe(0);
  });

  it('retorno pode descer abaixo de zero, porque prejuízo existe', () => {
    expect(domainOf([-0.12, 0.3])[0]).toBeLessThan(-0.12);
  });

  it('valor ilegível não vira zero', () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber('sem preço')).toBeNull();
    expect(toNumber('1204.1')).toBe(1204.1);
    expect(toPercentNumber('0.353')).toBeCloseTo(35.3, 10);
  });
});

describe('série', () => {
  it('buraco aparece como buraco, nunca como interpolação', () => {
    const segments = splitSegments([
      point('2026-10-01', '100'),
      point('2026-10-02', '110'),
      point('2026-10-03', null),
      point('2026-10-04', '130'),
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveLength(2);
    expect(segments[1]).toHaveLength(1);
  });

  it('série sem buraco é um traço só', () => {
    expect(
      splitSegments([point('2026-10-01', '100'), point('2026-10-02', '110')]),
    ).toHaveLength(1);
  });

  it('série inteiramente vazia não desenha nada', () => {
    expect(splitSegments([point('2026-10-01', null)])).toHaveLength(0);
  });

  it('dez anos de série diária cabem em um ponto por pixel', () => {
    const daily = Array.from({ length: 2520 }, (_, index) =>
      point(`2016-01-${String((index % 28) + 1).padStart(2, '0')}`, String(index)),
    );
    const reduced = downsample(daily, 600);

    expect(reduced.length).toBeLessThanOrEqual(1200);
    expect(reduced.length).toBeGreaterThan(300);
  });

  it('reduzir não apaga o pico de um dia', () => {
    const points = Array.from({ length: 1000 }, (_, index) =>
      point(`2026-01-01`, index === 517 ? '9999' : '10'),
    );
    const reduced = downsample(points, 50);
    expect(reduced.some((entry) => entry.value === '9999')).toBe(true);
  });

  it('reduzir preserva o buraco', () => {
    const points = Array.from({ length: 1000 }, (_, index) =>
      point('2026-01-01', index === 517 ? null : '10'),
    );
    expect(downsample(points, 50).some((entry) => entry.value === null)).toBe(true);
  });

  it('série curta não é reduzida', () => {
    const points = [point('2026-10-01', '1'), point('2026-10-02', '2')];
    expect(downsample(points, 600)).toBe(points);
  });

  it('a dica acompanha o ponto mais próximo do cursor', () => {
    const x = linearScale([0, 9], [0, 900]);
    expect(nearestIndex(0, 10, x)).toBe(0);
    expect(nearestIndex(449, 10, x)).toBe(4);
    expect(nearestIndex(451, 10, x)).toBe(5);
    expect(nearestIndex(900, 10, x)).toBe(9);
  });

  it('a dica troca de lado perto da borda direita', () => {
    expect(tooltipSide(100, 800, 220)).toBe('right');
    expect(tooltipSide(600, 800, 220)).toBe('left');
  });
});
