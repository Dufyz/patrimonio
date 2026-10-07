import { describe, expect, it } from 'vitest';

import { LEDGER_CASES } from '../__fixtures__/average_price/sequences.js';
import { applyLedger } from './ledger.js';

/**
 * As sequências obrigatórias da estratégia de testes, rodadas contra a fixture
 * conferida à mão. É o teste de regressão do motor: trocar um número aqui é uma
 * decisão, não um efeito colateral.
 */
describe('sequências conferidas à mão', () => {
  for (const scenario of LEDGER_CASES) {
    it(scenario.name, () => {
      const state = applyLedger(scenario.entries);

      expect(state.position).toEqual(scenario.position);
      expect(state.realized_total).toBe(scenario.realized_total);
      expect(state.oversold).toBe(false);
    });
  }

  it('nenhuma função do módulo recebe ou devolve lote individual de compra', () => {
    const state = applyLedger(LEDGER_CASES[0]?.entries ?? []);

    // O preço médio é único por ativo e carteira: a posição é uma linha, e o que
    // existe por operação é o resultado realizado da venda, não o lote de compra.
    expect(Object.keys(state.position).sort()).toEqual([
      'avg_price',
      'cost_basis',
      'quantity',
    ]);
    expect(state.realized.every((sale) => 'cost_consumed' in sale)).toBe(true);
  });
});
