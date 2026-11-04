import { describe, expect, it } from 'vitest';

import type { DateOnly } from '../support/date_only.js';
import {
  parseTreasuryTicker,
  treasuryName,
  treasuryTicker,
} from './instrument.treasury.js';

const maturity = '2035-05-15' as DateOnly;

describe('código do título do Tesouro', () => {
  it('é derivado do indexador e do vencimento', () => {
    expect(
      treasuryTicker({ kind: 'ipca_plus', coupon: false, maturity_date: maturity }),
    ).toBe('TD-IPCA-20350515');
    expect(
      treasuryTicker({
        kind: 'prefixed',
        coupon: false,
        maturity_date: '2027-01-01' as DateOnly,
      }),
    ).toBe('TD-PRE-20270101');
    expect(
      treasuryTicker({
        kind: 'selic_plus',
        coupon: false,
        maturity_date: '2029-03-01' as DateOnly,
      }),
    ).toBe('TD-SELIC-20290301');
  });

  it('separa o título com juros semestrais do mesmo vencimento sem eles', () => {
    const principal = treasuryTicker({
      kind: 'ipca_plus',
      coupon: false,
      maturity_date: maturity,
    });
    const semestral = treasuryTicker({
      kind: 'ipca_plus',
      coupon: true,
      maturity_date: maturity,
    });

    expect(semestral).toBe('TD-IPCAJS-20350515');
    expect(semestral).not.toBe(principal);
  });

  it('volta à identidade que o gerou', () => {
    const identity = {
      kind: 'ipca_plus',
      coupon: true,
      maturity_date: maturity,
    } as const;

    expect(parseTreasuryTicker(treasuryTicker(identity))).toEqual(identity);
  });

  it('não reconhece ticker que não é de título público', () => {
    expect(parseTreasuryTicker('ITUB4')).toBeNull();
    expect(parseTreasuryTicker('TD-XXX-20350515')).toBeNull();
  });

  it('escreve o nome como o Tesouro o publica', () => {
    expect(
      treasuryName({ kind: 'ipca_plus', coupon: false, maturity_date: maturity }),
    ).toBe('Tesouro IPCA+ 2035');
    expect(
      treasuryName({ kind: 'ipca_plus', coupon: true, maturity_date: maturity }),
    ).toBe('Tesouro IPCA+ com Juros Semestrais 2035');
    expect(
      treasuryName({ kind: 'selic_plus', coupon: false, maturity_date: maturity }),
    ).toBe('Tesouro Selic 2035');
  });
});
