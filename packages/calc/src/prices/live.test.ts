import { describe, expect, it } from 'vitest';

import {
  changeRatio,
  liveValuation,
  shiftSummary,
  sumDeltas,
  valueDelta,
  weightOf,
} from './live.js';

describe('liveValuation', () => {
  it('reavalia a posição a preço de pregão', () => {
    expect(
      liveValuation({
        quantity: '100',
        cost_basis: '3000.00',
        previous_price: '32.00',
        live_price: '33.60',
      }),
    ).toEqual({
      price: '33.60000000',
      value: '3360.00',
      open_result: '360.00',
      open_result_ratio: '0.12000000',
      day_change_ratio: '0.05000000',
    });
  });

  it('custo zero e preço anterior ausente viram ausência, não infinito', () => {
    const result = liveValuation({
      quantity: '1',
      cost_basis: '0',
      previous_price: null,
      live_price: '10',
    });

    expect(result.open_result_ratio).toBeNull();
    expect(result.day_change_ratio).toBeNull();
  });
});

describe('subtotais', () => {
  it('soma a diferença ao subtotal e recalcula a razão', () => {
    const delta = sumDeltas([
      valueDelta('3360.00', '3200.00'),
      valueDelta('10.00', '12.00'),
    ]);

    expect(delta).toBe('158.00');
    expect(
      shiftSummary(
        { value: '10000.00', cost_basis: '9000.00', open_result: '1000.00' },
        delta,
      ),
    ).toEqual({
      value: '10158.00',
      cost_basis: '9000.00',
      open_result: '1158.00',
      open_result_ratio: '0.12866667',
    });
  });

  it('peso e variação com total zero são ausência', () => {
    expect(weightOf('10', '0')).toBe('0');
    expect(weightOf('25', '100')).toBe('0.25000000');
    expect(changeRatio('10', '0')).toBeNull();
    expect(changeRatio('105', '100')).toBe('0.05000000');
  });
});
