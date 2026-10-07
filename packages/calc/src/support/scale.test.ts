import { describe, expect, it } from 'vitest';

import {
  isNegativeAmount,
  isZeroAmount,
  multiplyMoney,
  toMoney,
  toPrice,
  toQuantity,
} from './scale.js';

describe('as escalas do schema', () => {
  it('reais têm duas casas, sempre, inclusive em zero', () => {
    expect(toMoney('1204.1')).toBe('1204.10');
    expect(toMoney('0')).toBe('0.00');
    expect(toMoney('-3170')).toBe('-3170.00');
  });

  it('quantidade e preço têm oito casas', () => {
    expect(toQuantity('100')).toBe('100.00000000');
    expect(toPrice('30.099')).toBe('30.09900000');
  });

  it('string vazia é tratada como zero, não como NaN', () => {
    expect(toMoney('')).toBe('0.00');
    expect(toQuantity('')).toBe('0.00000000');
  });

  it('o valor é arredondado para a escala, não truncado', () => {
    expect(toMoney('10.005')).toBe('10.01');
    expect(toMoney('10.004')).toBe('10.00');
  });

  it('um valor que não cabe em double sobrevive à conversão', () => {
    expect(toPrice('12345678901.12345678')).toBe('12345678901.12345678');
  });
});

describe('produto em reais', () => {
  it('quantidade por cotação dá o valor da posição', () => {
    expect(multiplyMoney('100.00000000', '32.00')).toBe('3200.00');
  });

  it('custo por fator de curva dá o valor na curva', () => {
    expect(multiplyMoney('10000.00', '1.001348690000')).toBe('10013.49');
  });

  it('o produto é arredondado na escala de reais, uma vez só', () => {
    expect(multiplyMoney('3', '0.335')).toBe('1.01');
  });
});

describe('perguntas sobre o valor', () => {
  it('zero é zero em qualquer escrita', () => {
    expect(isZeroAmount('0')).toBe(true);
    expect(isZeroAmount('0.00000000')).toBe(true);
    expect(isZeroAmount('-0.00')).toBe(true);
    expect(isZeroAmount('0.01')).toBe(false);
  });

  it('negativo é reconhecido pelo sinal, não pelo texto', () => {
    expect(isNegativeAmount('-0.01')).toBe(true);
    expect(isNegativeAmount('0.00')).toBe(false);
    expect(isNegativeAmount('1')).toBe(false);
  });
});
