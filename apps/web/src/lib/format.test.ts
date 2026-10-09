import { describe, expect, it } from 'vitest';

import {
  DASH,
  MASK,
  formatCompact,
  formatMoney,
  formatMoneyChange,
  formatPercent,
  formatPoints,
  formatQuantity,
  formatQuota,
} from './format.js';

/**
 * A tabela de `Estratégia de testes`, seção "Formatação", virada em teste. Ela
 * existe porque é onde um erro passa despercebido: nenhuma dessas saídas quebra
 * a tela, todas mentem sobre o número.
 */
describe('formatação de número', () => {
  it('valor em reais alinha pela vírgula com duas casas', () => {
    expect(formatMoney('1204.1').text).toBe('R$ 1.204,10');
    expect(formatMoney('487320.55').text).toBe('R$ 487.320,55');
    expect(formatMoney('12345678.9').text).toBe('R$ 12.345.678,90');
  });

  it('variação em reais leva sinal de menos tipográfico', () => {
    expect(formatMoneyChange('-3170').text).toBe('−R$ 3.170,00');
  });

  it('variação positiva também leva sinal, para não depender só da cor', () => {
    expect(formatMoneyChange('1204.1').text).toBe('+R$ 1.204,10');
    expect(formatMoneyChange('1204.1').sign).toBe('+');
  });

  it('variação percentual converte a razão em percentual', () => {
    expect(formatPercent('0.0025', { signed: true }).text).toBe('+0,25%');
    expect(formatPercent('0.1592', { signed: true }).text).toBe('+15,92%');
    expect(formatPercent('-0.172', { signed: true }).text).toBe('−17,20%');
  });

  it('alocação usa uma casa e dispensa o sinal', () => {
    expect(formatPercent('0.353', { decimals: 1 }).text).toBe('35,3%');
  });

  it('diferença de alocação vem em pontos percentuais', () => {
    expect(formatPoints('4.2').text).toBe('+4,2 pp');
    expect(formatPoints('-0.9').text).toBe('−0,9 pp');
    expect(formatPoints('5.14', { decimals: 2 }).text).toBe('+5,14 pp');
  });

  it('modo compacto encurta milhar e milhão', () => {
    expect(formatCompact('318900').text).toBe('318,9k');
    expect(formatCompact('1200000').text).toBe('1,2M');
    expect(formatCompact('300000').text).toBe('300k');
    expect(formatCompact('1500000000').text).toBe('1,5B');
  });

  it('modo compacto não encurta o que já cabe', () => {
    expect(formatCompact('999').text).toBe('999');
    expect(formatCompact('0').text).toBe('0');
  });

  it('valor oculto vira marca de largura fixa e o percentual continua visível', () => {
    expect(formatMoney('487320.55', { hidden: true }).text).toBe(`R$ ${MASK}`);
    expect(formatMoneyChange('1512.3', { hidden: true }).text).toBe(MASK);
    expect(formatPercent('0.0031', { signed: true }).text).toBe('+0,31%');
  });

  it('valor oculto não vaza a direção pelo sinal', () => {
    expect(formatMoneyChange('-99999.99', { hidden: true }).sign).toBe('');
  });

  it('ausência é traço', () => {
    expect(formatMoney(null).text).toBe(DASH);
    expect(formatMoney(undefined).text).toBe(DASH);
    expect(formatPercent('não é número').text).toBe(DASH);
    expect(formatMoney(null).available).toBe(false);
  });

  it('zero é zero, nunca traço', () => {
    expect(formatMoney('0').text).toBe('R$ 0,00');
    expect(formatPercent('0').text).toBe('0,00%');
    expect(formatMoney('0').available).toBe(true);
  });

  it('quantidade inteira aparece sem casas e fracionária com duas', () => {
    expect(formatQuantity('500').text).toBe('500');
    expect(formatQuantity('22.4').text).toBe('22,40');
    expect(formatQuantity('0.74').text).toBe('0,74');
    expect(formatQuantity('1000').text).toBe('1.000');
  });

  it('quantidade pequena demais abre casas em vez de virar zero', () => {
    // Arredonda — a palavra é da estratégia de testes — até a primeira casa
    // que mostra alguma coisa. O que não pode é virar `0,00`.
    expect(formatQuantity('0.000000005').text).toBe('0,00000001');
    expect(formatQuantity('0.004').text).toBe('0,004');
  });

  it('quantidade zero continua sendo zero', () => {
    expect(formatQuantity('0').text).toBe('0');
  });

  it('cota mantém casas fixas, porque é a base do retorno', () => {
    expect(formatQuota('1.23456789').text).toBe('1,23456789');
    expect(formatQuota('2').text).toBe('2,00000000');
  });

  it('arredondamento é meio para cima em valor absoluto', () => {
    expect(formatMoney('1.005').text).toBe('R$ 1,01');
    expect(formatMoney('-1.005').text).toBe('−R$ 1,01');
    expect(formatMoney('1.004').text).toBe('R$ 1,00');
  });

  it('arredondar nove vira a casa inteira sem perder dígito', () => {
    expect(formatMoney('9.999').text).toBe('R$ 10,00');
    expect(formatMoney('999999.999').text).toBe('R$ 1.000.000,00');
  });

  it('valor grande demais para um number continua exato', () => {
    expect(formatMoney('9007199254740993.21').text).toBe('R$ 9.007.199.254.740.993,21');
  });
});
