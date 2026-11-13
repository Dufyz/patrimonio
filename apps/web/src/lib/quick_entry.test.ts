import { describe, expect, it } from 'vitest';

import { parseDecimal, parseQuickEntry, quickEntryLabel } from './quick_entry.js';

/** NAV-10 · O interpretador é função pura, e a tabela é o contrato dele. */
describe('parseQuickEntry (NAV-10)', () => {
  it.each([
    [
      'aporte 80 divo11 32,40',
      { verb: 'buy', amount: '80', ticker: 'DIVO11', price: '32.40' },
    ],
    ['aporte 80 DIVO11', { verb: 'buy', amount: '80', ticker: 'DIVO11', price: null }],
    [
      'Compra 10 petr4 38,15',
      { verb: 'buy', amount: '10', ticker: 'PETR4', price: '38.15' },
    ],
    [
      'resgate 5 bova11 120,5',
      { verb: 'sell', amount: '5', ticker: 'BOVA11', price: '120.5' },
    ],
    [
      'venda 1.250 itub4 31,00',
      { verb: 'sell', amount: '1250', ticker: 'ITUB4', price: '31.00' },
    ],
    [
      'provento 12,50 divo11',
      { verb: 'payout', amount: '12.50', ticker: 'DIVO11', price: null },
    ],
    [
      '  aporte   0,5  btlg11  ',
      { verb: 'buy', amount: '0.5', ticker: 'BTLG11', price: null },
    ],
  ])('%s → campos', (text, expected) => {
    expect(parseQuickEntry(text)).toEqual(expected);
  });

  it.each([
    ['', 'vazio'],
    ['aporte', 'só o verbo'],
    ['aporte divo11', 'sem quantidade'],
    ['aporte 80', 'sem ativo'],
    ['aporte 80 divo', 'ativo sem cara de código'],
    ['transferir 80 divo11', 'verbo desconhecido'],
    ['aporte oitenta divo11', 'quantidade que não é número'],
    ['aporte 0 divo11', 'quantidade zero'],
    ['aporte 80 divo11 zero', 'preço que não é número'],
    ['aporte 80 divo11 32,40 extra', 'sobra de texto'],
    ['aporte 1,2,3 divo11', 'número malformado'],
  ])('%s não gera ação (%s)', (text) => {
    expect(parseQuickEntry(text)).toBeNull();
  });

  it('parseDecimal entende milhar, vírgula e ponto decimal', () => {
    expect(parseDecimal('1.250,5')).toBe('1250.5');
    expect(parseDecimal('1.250')).toBe('1250');
    expect(parseDecimal('32.40')).toBe('32.40');
    expect(parseDecimal('32,40')).toBe('32.40');
    expect(parseDecimal('-3')).toBeNull();
    expect(parseDecimal('1.2.3')).toBeNull();
  });

  it('o rótulo é a frase do resultado', () => {
    const entry = parseQuickEntry('aporte 80 divo11 32,40');
    expect(entry && quickEntryLabel(entry)).toBe('Lançar aporte de 80 DIVO11 a R$ 32,40');
    const payout = parseQuickEntry('provento 1.250,5 divo11');
    expect(payout && quickEntryLabel(payout)).toBe(
      'Lançar provento de R$ 1.250,50 de DIVO11',
    );
  });
});
