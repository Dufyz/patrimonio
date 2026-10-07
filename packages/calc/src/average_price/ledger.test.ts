import { describe, expect, it } from 'vitest';

import { applyLedger, cashBalance, positionAt, proportionalCost } from './ledger.js';
import type { LedgerEntry } from './ledger.js';

const compra = (
  trade_date: string,
  quantity: string,
  unit_price: string,
  fees = '0',
  id?: string,
): LedgerEntry => ({
  ...(id === undefined ? {} : { id }),
  kind: 'buy',
  trade_date,
  quantity,
  unit_price,
  fees,
  net_amount: `-${(Number(quantity) * Number(unit_price) + Number(fees)).toFixed(2)}`,
});

const venda = (
  trade_date: string,
  quantity: string,
  unit_price: string,
  fees = '0',
  id?: string,
): LedgerEntry => ({
  ...(id === undefined ? {} : { id }),
  kind: 'sell',
  trade_date,
  quantity,
  unit_price,
  fees,
  net_amount: (Number(quantity) * Number(unit_price) - Number(fees)).toFixed(2),
});

const evento = (
  trade_date: string,
  event_ratio_from: string,
  event_ratio_to: string,
): LedgerEntry => ({
  kind: 'corporate_event',
  trade_date,
  quantity: '0',
  unit_price: '0',
  fees: '0',
  net_amount: '0',
  event_ratio_from,
  event_ratio_to,
});

describe('preço médio', () => {
  it('compra, compra, venda parcial e compra: a venda não altera o preço médio', () => {
    const { position } = applyLedger([
      compra('2024-01-10', '100', '30.00'),
      compra('2024-02-10', '100', '40.00'),
      venda('2024-03-10', '50', '50.00'),
      compra('2024-04-10', '50', '35.00'),
    ]);

    // 100×30 + 100×40 = 7.000 por 200 cotas: 35,00. A venda de 50 consome
    // 1.750 e deixa 150 cotas a 35,00. A compra de 50 a 35,00 mantém 35,00.
    expect(position.quantity).toBe('200.00000000');
    expect(position.avg_price).toBe('35.00000000');
    expect(position.cost_basis).toBe('7000.00');
  });

  it('taxas entram no custo, não no preço unitário', () => {
    const { position } = applyLedger([compra('2024-01-10', '100', '30.00', '9.00')]);

    expect(position.cost_basis).toBe('3009.00');
    expect(position.avg_price).toBe('30.09000000');
  });

  it('venda parcial consome custo proporcional e devolve o resultado da venda', () => {
    const { realized, realized_total } = applyLedger([
      compra('2024-01-10', '100', '30.00'),
      venda('2024-03-10', '40', '45.00', '5.00'),
    ]);

    // 40 × 45 − 5 = 1.795 recebidos; custo consumido 40 × 30 = 1.200.
    expect(realized).toHaveLength(1);
    expect(realized[0]?.proceeds).toBe('1795.00');
    expect(realized[0]?.cost_consumed).toBe('1200.00');
    expect(realized_total).toBe('595.00');
  });

  it('venda que zera a posição faz o preço médio recomeçar do zero na recompra', () => {
    const { position } = applyLedger([
      compra('2024-01-10', '100', '30.00'),
      venda('2024-02-10', '100', '45.00'),
      compra('2024-03-10', '100', '20.00'),
    ]);

    expect(position.avg_price).toBe('20.00000000');
    expect(position.cost_basis).toBe('2000.00');
  });

  it('venda acima da quantidade disponível é marcada, e a posição não fica negativa', () => {
    const resultado = applyLedger([
      compra('2024-01-10', '100', '30.00'),
      venda('2024-02-10', '150', '45.00'),
    ]);

    expect(resultado.oversold).toBe(true);
    expect(resultado.position.quantity).toBe('0.00000000');
  });

  it('desdobramento 1:2 dobra a quantidade, divide o preço médio e mantém o custo', () => {
    const { position } = applyLedger([
      compra('2024-01-10', '100', '30.00'),
      evento('2024-06-10', '1', '2'),
    ]);

    expect(position.quantity).toBe('200.00000000');
    expect(position.avg_price).toBe('15.00000000');
    expect(position.cost_basis).toBe('3000.00');
  });

  it('grupamento 10:1 com quantidade ímpar trata a sobra como fração, sem perder custo', () => {
    const { position } = applyLedger([
      compra('2024-01-10', '105', '10.00'),
      evento('2024-06-10', '10', '1'),
    ]);

    expect(position.quantity).toBe('10.50000000');
    expect(position.cost_basis).toBe('1050.00');
    expect(position.avg_price).toBe('100.00000000');
  });

  it('amortização reduz o custo da posição em vez de contar como rendimento', () => {
    const { position } = applyLedger([
      compra('2024-01-10', '100', '10.00'),
      {
        kind: 'payout',
        trade_date: '2024-07-10',
        quantity: '0',
        unit_price: '0',
        fees: '0',
        net_amount: '200.00',
        payout_kind: 'amortization',
      },
    ]);

    expect(position.cost_basis).toBe('800.00');
    expect(position.avg_price).toBe('8.00000000');
  });

  it('dividendo não mexe na posição', () => {
    const { position } = applyLedger([
      compra('2024-01-10', '100', '10.00'),
      {
        kind: 'payout',
        trade_date: '2024-07-10',
        quantity: '0',
        unit_price: '0',
        fees: '0',
        net_amount: '123.45',
        payout_kind: 'dividend',
      },
    ]);

    expect(position.cost_basis).toBe('1000.00');
  });
});

describe('transferência entre carteiras', () => {
  const saida: LedgerEntry = {
    kind: 'transfer',
    trade_date: '2024-05-10',
    quantity: '40',
    unit_price: '30.00',
    fees: '0',
    net_amount: '-1200.00',
  };

  const entrada: LedgerEntry = { ...saida, net_amount: '1200.00' };

  it('a perna que sai leva o custo pelo preço médio e não gera resultado', () => {
    const resultado = applyLedger([compra('2024-01-10', '100', '30.00'), saida]);

    expect(resultado.position.quantity).toBe('60.00000000');
    expect(resultado.position.avg_price).toBe('30.00000000');
    expect(resultado.realized).toHaveLength(0);
  });

  it('a perna que entra preserva o preço médio da origem', () => {
    const resultado = applyLedger([entrada]);

    expect(resultado.position.quantity).toBe('40.00000000');
    expect(resultado.position.avg_price).toBe('30.00000000');
    expect(resultado.position.cost_basis).toBe('1200.00');
  });

  it('as duas pernas usam o mesmo custo, e a soma das carteiras não muda', () => {
    const inicial = compra('2024-01-10', '100', '30.00');

    const antes = applyLedger([inicial]);
    const origem = applyLedger([inicial, saida]);
    const destino = applyLedger([entrada]);

    expect(
      Number(origem.position.cost_basis) + Number(destino.position.cost_basis),
    ).toBe(Number(antes.position.cost_basis));
  });

  it('o custo que viaja é proporcional, e é o custo inteiro quando tudo sai', () => {
    // Um custo que não divide redondo: 1.000,01 em 3 cotas.
    expect(proportionalCost('1000.01', '1', '3')).toBe('333.34');
    expect(proportionalCost('1000.01', '3', '3')).toBe('1000.01');
    // Pedir mais do que existe não inventa custo além do que há.
    expect(proportionalCost('1000.01', '5', '3')).toBe('1000.01');
    expect(proportionalCost('1000.01', '1', '0')).toBe('1000.01');
  });

  it('transferir a posição toda zera o custo da origem', () => {
    const resultado = applyLedger([
      compra('2024-01-10', '100', '30.00'),
      {
        kind: 'transfer',
        trade_date: '2024-05-10',
        quantity: '100',
        unit_price: '30.00',
        fees: '0',
        net_amount: '-3000.00',
      },
    ]);

    expect(resultado.position.quantity).toBe('0.00000000');
    expect(resultado.position.cost_basis).toBe('0.00');
    expect(resultado.realized).toHaveLength(0);
  });
});

describe('ordem e corte por data', () => {
  it('ordem de inserção embaralhada dá o mesmo resultado que a cronológica', () => {
    const cronologica = applyLedger([
      compra('2024-01-10', '100', '30.00', '0', '0190'),
      compra('2024-02-10', '100', '40.00', '0', '0290'),
      venda('2024-03-10', '50', '50.00', '0', '0390'),
    ]);

    const embaralhada = applyLedger([
      venda('2024-03-10', '50', '50.00', '0', '0390'),
      compra('2024-01-10', '100', '30.00', '0', '0190'),
      compra('2024-02-10', '100', '40.00', '0', '0290'),
    ]);

    expect(embaralhada).toEqual(cronologica);
  });

  it('a posição em uma data ignora o que veio depois: é o "antes" do preview', () => {
    const entries = [
      compra('2024-01-10', '100', '30.00'),
      compra('2024-06-10', '100', '40.00'),
    ];

    expect(positionAt(entries, '2024-03-01').quantity).toBe('100.00000000');
    expect(positionAt(entries, '2024-12-01').quantity).toBe('200.00000000');
  });
});

describe('caixa', () => {
  it('é a soma do que entrou e saiu, não uma coluna de saldo', () => {
    const balance = cashBalance([
      {
        kind: 'deposit',
        trade_date: '2024-01-02',
        quantity: '5000',
        unit_price: '1',
        fees: '0',
        net_amount: '5000.00',
      },
      compra('2024-01-10', '100', '30.00', '4.90'),
      venda('2024-02-10', '50', '35.00'),
    ]);

    // 5.000 − 3.004,90 + 1.750 = 3.745,10
    expect(balance).toBe('3745.10');
  });
});
