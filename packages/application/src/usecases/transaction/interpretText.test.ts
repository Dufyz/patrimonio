import { describe, expect, it } from 'vitest';

import { interpretTransactionText } from './interpretText.js';

const hoje = { today: '2026-10-06' };

describe('lançamento por texto', () => {
  it('interpreta tipo, quantidade, ativo, preço e data', () => {
    const resultado = interpretTransactionText('compra 100 itub4 36,84 ontem', hoje);

    expect(resultado.kind).toBe('buy');
    expect(resultado.quantity).toBe('100');
    expect(resultado.ticker).toBe('ITUB4');
    expect(resultado.unit_price).toBe('36.84');
    expect(resultado.trade_date).toBe('2026-10-05');
    expect(resultado.total_amount).toBe('3684.00');
    expect(resultado.ambiguous).toBe(false);
  });

  it('a interpretação vem em pastilhas, na ordem em que a tela mostra', () => {
    const { chips } = interpretTransactionText('compra 100 itub4 36,84 ontem', hoje);

    expect(chips.map((chip) => chip.field)).toEqual([
      'kind',
      'asset',
      'quantity',
      'trade_date',
      'total',
    ]);
    expect(chips[0]?.value).toBe('Compra');
    expect(chips[4]?.value).toBe('3684.00');
  });

  it('sem data escrita, o lançamento é de hoje', () => {
    const resultado = interpretTransactionText('compra 100 itub4 36,84', hoje);

    expect(resultado.trade_date).toBe('2026-10-06');
  });

  it('entende venda e as abreviações do dia a dia', () => {
    expect(interpretTransactionText('v 50 vale3 61,20', hoje).kind).toBe('sell');
    expect(interpretTransactionText('c 50 vale3 61,20', hoje).kind).toBe('buy');
    expect(interpretTransactionText('vendi 50 vale3 61,20', hoje).ticker).toBe('VALE3');
  });

  it('o preço aceita vírgula, ponto e separador de milhar', () => {
    expect(interpretTransactionText('compra 1 knri11 1.598,40', hoje).unit_price).toBe(
      '1598.40',
    );
    expect(interpretTransactionText('compra 1 knri11 158.90', hoje).unit_price).toBe(
      '158.90',
    );
  });

  it('entende data em formato brasileiro e ISO', () => {
    expect(
      interpretTransactionText('compra 100 itub4 36,84 12/03', hoje).trade_date,
    ).toBe('2026-03-12');
    expect(
      interpretTransactionText('compra 100 itub4 36,84 12/03/2021', hoje).trade_date,
    ).toBe('2021-03-12');
    expect(
      interpretTransactionText('compra 100 itub4 36,84 2021-03-12', hoje).trade_date,
    ).toBe('2021-03-12');
  });

  it('JCP e dividendo viram provento com o tipo certo', () => {
    const jcp = interpretTransactionText('jcp 500 itub4 0,22616', hoje);

    expect(jcp.kind).toBe('payout');
    expect(jcp.payout_kind).toBe('jcp');
  });

  it('o primeiro número é quantidade e o segundo é preço', () => {
    const resultado = interpretTransactionText('compra 36 itub4 100', hoje);

    expect(resultado.quantity).toBe('36');
    expect(resultado.unit_price).toBe('100');
  });

  it('texto sem tipo é ambíguo e não salva', () => {
    const resultado = interpretTransactionText('100 itub4 36,84', hoje);

    expect(resultado.ambiguous).toBe(true);
    expect(resultado.missing).toContain('tipo do lançamento');
  });

  it('texto sem ativo é ambíguo e diz o que falta', () => {
    const resultado = interpretTransactionText('compra 100 36,84', hoje);

    expect(resultado.ambiguous).toBe(true);
    expect(resultado.missing).toContain('ativo');
  });

  it('texto sem preço é ambíguo', () => {
    const resultado = interpretTransactionText('compra 100 itub4', hoje);

    expect(resultado.ambiguous).toBe(true);
    expect(resultado.missing).toContain('preço unitário');
  });

  it('aporte não exige ativo nem preço', () => {
    const resultado = interpretTransactionText('aporte 5000', hoje);

    expect(resultado.kind).toBe('deposit');
    expect(resultado.quantity).toBe('5000');
    expect(resultado.ambiguous).toBe(false);
  });

  it('código fora do padrão da B3 ainda vira candidato a ativo', () => {
    const resultado = interpretTransactionText(
      'compra 10 tesouro-ipca-2029 3.412,55',
      hoje,
    );

    expect(resultado.ticker).toBe('TESOURO-IPCA-2029');
    expect(resultado.unit_price).toBe('3412.55');
  });
});
