import { describe, expect, it } from 'vitest';

import { maskMoney, maskPercent } from './money_mask.js';
import { parseAmountInput } from './positions.js';

describe('maskMoney', () => {
  it('agrupa o milhar e mantém a vírgula decimal', () => {
    expect(maskMoney('1234')).toBe('1.234');
    expect(maskMoney('1234567,5')).toBe('1.234.567,5');
    expect(maskMoney('1.234,56')).toBe('1.234,56');
  });

  it('é idempotente: remascarar o que já está mascarado não muda nada', () => {
    for (const value of ['1.234', '12.345.678', '36,84', '0,5', '1.234,']) {
      expect(maskMoney(value)).toBe(value);
    }
  });

  it('o ponto que não forma milhar é decimal', () => {
    expect(maskMoney('36.84')).toBe('36,84');
    expect(maskMoney('1234.')).toBe('1.234,');
    expect(maskMoney('0.5')).toBe('0,5');
  });

  it('digitar o milhar dígito a dígito continua sendo milhar', () => {
    let text = '';
    for (const key of '1234567') text = maskMoney(text + key);
    expect(text).toBe('1.234.567');
    expect(maskMoney('1.0000')).toBe('10.000');
    // com mais casas (preço de cota), o ponto depois do milhar segue decimal
    expect(maskMoney('1.2345', 4)).toBe('1,2345');
  });

  it('limita as casas decimais e descarta o que não é número', () => {
    expect(maskMoney('1,2345')).toBe('1,23');
    expect(maskMoney('1,2345', 4)).toBe('1,2345');
    expect(maskMoney('R$ 12a')).toBe('12');
    expect(maskMoney('abc')).toBe('');
  });

  it('tira zeros à esquerda e completa a vírgula solta com zero', () => {
    expect(maskMoney('007')).toBe('7');
    expect(maskMoney(',5')).toBe('0,5');
  });

  it('o resultado da máscara é lido por parseAmountInput sem ambiguidade', () => {
    expect(parseAmountInput(maskMoney('1234'))).toBe('1234');
    expect(parseAmountInput(maskMoney('1234,5'))).toBe('1234.5');
    expect(parseAmountInput(maskMoney('1234567'))).toBe('1234567');
  });
});

describe('maskPercent', () => {
  it('até duas casas, com vírgula', () => {
    expect(maskPercent('13')).toBe('13');
    expect(maskPercent('13,7')).toBe('13,7');
    expect(maskPercent('13,75')).toBe('13,75');
    expect(maskPercent('13,759')).toBe('13,75');
    expect(maskPercent('13.75')).toBe('13,75');
    expect(maskPercent(',5')).toBe('0,5');
    expect(maskPercent('007')).toBe('7');
    expect(maskPercent('12%')).toBe('12');
    expect(maskPercent('abc')).toBe('');
  });

  it('nunca passa de 100', () => {
    expect(maskPercent('100')).toBe('100');
    expect(maskPercent('101')).toBe('10');
    expect(maskPercent('100,5')).toBe('100');
  });
});
