import { LEDGER_EFFECTS, LEDGER_KINDS } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import { freeAfterInvoices, monthCascade, wealth } from './wealth.js';

/** Fixture de 11/11/2026 (§2.3 da especificação). */
describe('cascata do mês (LIV-08)', () => {
  it('Receitas − Despesas − Aportes = Saldo do mês', () => {
    const cascade = monthCascade({
      receitas: '8720.00',
      despesas: '3842.43',
      aportes: '2000.00',
    });
    expect(cascade.saldo_do_mes).toBe('2877.57');
  });

  it('o saldo pode ser negativo e mantém o sinal', () => {
    expect(
      monthCascade({ receitas: '100.00', despesas: '50.00', aportes: '80.00' })
        .saldo_do_mes,
    ).toBe('-30.00');
  });

  it('soma em centavos sem erro de ponto flutuante', () => {
    expect(
      monthCascade({ receitas: '0.30', despesas: '0.10', aportes: '0.10' }).saldo_do_mes,
    ).toBe('0.10');
  });
});

describe('matriz de efeitos (LIV-01)', () => {
  it('cobre exatamente os oito tipos', () => {
    expect([...LEDGER_KINDS]).toEqual([
      'RECEITA',
      'DESPESA',
      'TRANSFERENCIA',
      'PAGAMENTO_FATURA',
      'APORTE',
      'RESGATE',
      'PROVENTO',
      'EVENTO',
    ]);
    expect(Object.keys(LEDGER_EFFECTS).sort()).toEqual([...LEDGER_KINDS].sort());
  });

  it('só receita entra em Receitas e só despesa entra em Despesas', () => {
    for (const kind of LEDGER_KINDS) {
      expect(LEDGER_EFFECTS[kind].receitas).toBe(kind === 'RECEITA');
      expect(LEDGER_EFFECTS[kind].despesas).toBe(kind === 'DESPESA');
      expect(LEDGER_EFFECTS[kind].aportes).toBe(kind === 'APORTE');
    }
  });

  it('provento e resgate não alteram o Saldo do mês', () => {
    expect(LEDGER_EFFECTS.PROVENTO.saldo_do_mes).toBe(0);
    expect(LEDGER_EFFECTS.RESGATE.saldo_do_mes).toBe(0);
  });

  it('aporte reduz o Saldo do mês e não muda o patrimônio', () => {
    expect(LEDGER_EFFECTS.APORTE.saldo_do_mes).toBe(-1);
    expect(LEDGER_EFFECTS.APORTE.patrimonio).toBe('igual');
  });
});

describe('Patrimônio total (LIV-09)', () => {
  it('Em carteiras + Em contas', () => {
    expect(wealth({ em_carteiras: '194998.09', em_contas: '1462.51' })).toEqual({
      em_carteiras: '194998.09',
      em_contas: '1462.51',
      patrimonio: '196460.60',
    });
  });

  it('carteira não consolidada deixa o patrimônio nulo, nunca zero', () => {
    const result = wealth({ em_carteiras: null, em_contas: '1462.51' });
    expect(result.em_carteiras).toBeNull();
    expect(result.patrimonio).toBeNull();
  });
});

describe('Livre após faturas (LIV-09)', () => {
  it('contas menores que as faturas: livre zero e a diferença que falta', () => {
    expect(freeAfterInvoices('1462.51', '2167.42', '2100.95')).toEqual({
      livre: '0.00',
      falta: '2805.86',
      total_devido: '4268.37',
    });
  });

  it('contas que cobrem as faturas: a sobra é livre e nada falta', () => {
    expect(freeAfterInvoices('5000.00', '1000.00', '500.00')).toEqual({
      livre: '3500.00',
      falta: '0.00',
      total_devido: '1500.00',
    });
  });

  it('sem fatura, tudo em contas é livre', () => {
    expect(freeAfterInvoices('1462.51', '0.00', '0.00').livre).toBe('1462.51');
  });
});
