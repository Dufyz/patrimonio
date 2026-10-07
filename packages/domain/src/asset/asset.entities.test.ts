import { describe, expect, it } from 'vitest';

import { describeFixedIncome, fixedIncomeTicker, isB3Type } from './asset.entities.js';

describe('nome exibido do título', () => {
  it('junta tipo, emissor, vencimento e taxa', () => {
    expect(
      describeFixedIncome({
        kind: 'cdb',
        issuer_name: 'Banco C',
        maturity_date: '2028-10-06',
        indexer: 'cdi_pct',
        rate: '112',
      }),
    ).toBe('CDB · Banco C · 10/2028 · 112% CDI');
  });

  it('cada indexador tem a sua forma de dizer a taxa', () => {
    const base = {
      kind: 'cdb',
      issuer_name: 'Banco C',
      maturity_date: '2030-05-15',
    } as const;

    expect(
      describeFixedIncome({ ...base, indexer: 'ipca_plus', rate: '6.12' }),
    ).toContain('IPCA + 6.12%');
    expect(describeFixedIncome({ ...base, indexer: 'prefixed', rate: '11' })).toContain(
      '11% a.a.',
    );
    expect(
      describeFixedIncome({ ...base, indexer: 'selic_plus', rate: '0.5' }),
    ).toContain('Selic + 0.5%');
  });

  it('sem taxa declarada, o nome ainda identifica o papel', () => {
    expect(
      describeFixedIncome({
        kind: 'debenture',
        issuer_name: 'Companhia X',
        maturity_date: null,
        indexer: null,
        rate: null,
      }),
    ).toBe('DEBENTURE · Companhia X');
  });
});

describe('código interno do título', () => {
  it('é estável e legível, sem acento nem espaço', () => {
    expect(
      fixedIncomeTicker({
        kind: 'cdb',
        issuer_name: 'Banco Inter S.A.',
        maturity_date: '2028-10-06',
      }),
    ).toBe('CDB-BANCOINT-20281006');
  });

  it('o sufixo separa dois papéis do mesmo emissor e vencimento', () => {
    expect(
      fixedIncomeTicker({
        kind: 'cdb',
        issuer_name: 'Banco C',
        maturity_date: '2028-10-06',
        suffix: '2',
      }),
    ).toBe('CDB-BANCOC-20281006-2');
  });
});

describe('tipo da B3', () => {
  it('reconhece os tipos que a classificação automática usa', () => {
    expect(isB3Type('fii')).toBe(true);
    expect(isB3Type('acao')).toBe(false);
  });
});
