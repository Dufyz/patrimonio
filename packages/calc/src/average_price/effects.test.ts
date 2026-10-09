import { describe, expect, it } from 'vitest';

import { applyLedger, ledgerEffects } from './ledger.js';
import type { LedgerEntry } from './ledger.js';

/**
 * A coluna "Efeito" de Movimentações sai daqui. O que esta suíte garante é a
 * única promessa que importa para ela: o efeito de cada lançamento é o passo do
 * mesmo motor que o recálculo usa, e não uma conta paralela.
 */

const compra = (
  id: string,
  trade_date: string,
  quantity: string,
  unit_price: string,
  fees = '0',
): LedgerEntry => ({
  id,
  kind: 'buy',
  trade_date,
  quantity,
  unit_price,
  fees,
  net_amount: `-${(Number(quantity) * Number(unit_price) + Number(fees)).toFixed(2)}`,
});

const venda = (
  id: string,
  trade_date: string,
  quantity: string,
  unit_price: string,
): LedgerEntry => ({
  id,
  kind: 'sell',
  trade_date,
  quantity,
  unit_price,
  fees: '0',
  net_amount: (Number(quantity) * Number(unit_price)).toFixed(2),
});

describe('ledgerEffects', () => {
  it('mostra o preço médio antes e depois de cada compra', () => {
    const effects = ledgerEffects([
      compra('a', '2026-01-10', '100', '40'),
      compra('b', '2026-02-10', '100', '30'),
    ]);

    expect(effects.get('a')?.before.avg_price).toBe('0.00000000');
    expect(effects.get('a')?.after.avg_price).toBe('40.00000000');
    expect(effects.get('b')?.before.avg_price).toBe('40.00000000');
    expect(effects.get('b')?.after.avg_price).toBe('35.00000000');
    expect(effects.get('b')?.after.quantity).toBe('200.00000000');
    expect(effects.get('b')?.realized_result).toBeNull();
  });

  it('a venda traz o resultado realizado e não mexe no preço médio', () => {
    const effects = ledgerEffects([
      compra('a', '2026-01-10', '100', '40'),
      venda('v', '2026-03-10', '50', '37'),
    ]);

    const sale = effects.get('v');

    expect(sale?.realized_result).toBe('-150.00');
    expect(sale?.before.avg_price).toBe('40.00000000');
    expect(sale?.after.avg_price).toBe('40.00000000');
    expect(sale?.after.quantity).toBe('50.00000000');
    expect(sale?.oversold).toBe(false);
  });

  it('concorda com o motor do recálculo, lançamento a lançamento', () => {
    const entries = [
      compra('a', '2026-01-10', '100', '40', '5'),
      compra('b', '2026-02-10', '30', '45'),
      venda('v', '2026-03-10', '60', '50'),
    ];

    const effects = ledgerEffects(entries);
    const total = applyLedger(entries);

    expect(effects.get('v')?.after).toEqual(total.position);
    expect(effects.get('v')?.realized_result).toBe(total.realized_total);
  });

  it('ordena pelo livro, não pela ordem em que as linhas chegam', () => {
    const embaralhado = ledgerEffects([
      venda('v', '2026-03-10', '50', '37'),
      compra('a', '2026-01-10', '100', '40'),
    ]);

    expect(embaralhado.get('v')?.realized_result).toBe('-150.00');
    expect(embaralhado.get('a')?.before.quantity).toBe('0.00000000');
  });

  it('marca a venda maior do que a posição, e só ela', () => {
    const effects = ledgerEffects([
      compra('a', '2026-01-10', '10', '40'),
      venda('v', '2026-03-10', '25', '37'),
      venda('w', '2026-03-11', '5', '37'),
    ]);

    expect(effects.get('a')?.oversold).toBe(false);
    expect(effects.get('v')?.oversold).toBe(true);
    // A posição já estava zerada e marcada: a segunda venda não é "a" que estourou.
    expect(effects.get('w')?.oversold).toBe(false);
  });

  it('desdobramento muda quantidade e preço médio sem mudar o custo', () => {
    const effects = ledgerEffects([
      compra('a', '2026-01-10', '100', '40'),
      {
        id: 'e',
        kind: 'corporate_event',
        trade_date: '2026-02-01',
        quantity: '0',
        unit_price: '0',
        fees: '0',
        net_amount: '0',
        event_ratio_from: '1',
        event_ratio_to: '2',
      },
    ]);

    const event = effects.get('e');

    expect(event?.before.quantity).toBe('100.00000000');
    expect(event?.after.quantity).toBe('200.00000000');
    expect(event?.after.avg_price).toBe('20.00000000');
    expect(event?.after.cost_basis).toBe(event?.before.cost_basis);
  });

  it('rascunho sem id entra na conta e não aparece no mapa', () => {
    const effects = ledgerEffects([
      compra('a', '2026-01-10', '100', '40'),
      {
        kind: 'buy',
        trade_date: '2026-01-11',
        quantity: '100',
        unit_price: '20',
        fees: '0',
        net_amount: '-2000.00',
      },
    ]);

    expect([...effects.keys()]).toEqual(['a']);
  });
});
