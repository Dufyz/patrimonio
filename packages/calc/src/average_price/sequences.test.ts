import { describe, expect, it } from 'vitest';

import {
  LEDGER_CASES,
  buy,
  corporateEvent,
  sell,
} from '../__fixtures__/average_price/sequences.js';
import { applyLedger } from './ledger.js';
import type { LedgerEntry } from './ledger.js';

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

/**
 * C-02, último critério: a soma dos resultados realizados mais o resultado aberto
 * bate com a variação patrimonial descontados os aportes.
 *
 * É a identidade que amarra as três respostas da tela do ativo. Se ela não fecha,
 * uma das três está errada e não há como saber qual — e é por isso que ela merece
 * teste próprio, com números que dividem redondo e tolerância zero.
 */
describe('a identidade que amarra realizado, aberto e variação', () => {
  const identity = (
    entries: readonly LedgerEntry[],
    marketPrice: string,
  ): {
    readonly realizadoMaisAberto: string;
    readonly variacaoMenosAportes: string;
  } => {
    const state = applyLedger(entries);

    const aportes = entries
      .filter((entry) => entry.kind === 'buy')
      .reduce(
        (total, entry) =>
          total + Number(entry.quantity) * Number(entry.unit_price) + Number(entry.fees),
        0,
      );

    const caixaDasVendas = state.realized.reduce(
      (total, sale) => total + Number(sale.proceeds),
      0,
    );

    const valorDaPosicao = Number(state.position.quantity) * Number(marketPrice);
    const patrimonio = valorDaPosicao + caixaDasVendas;

    const aberto = valorDaPosicao - Number(state.position.cost_basis);

    return {
      realizadoMaisAberto: (Number(state.realized_total) + aberto).toFixed(2),
      variacaoMenosAportes: (patrimonio - aportes).toFixed(2),
    };
  };

  it('fecha com posição aberta, depois de duas compras e uma venda parcial', () => {
    const { realizadoMaisAberto, variacaoMenosAportes } = identity(
      [
        buy('2024-01-10', '100', '30.00'),
        buy('2024-02-10', '100', '40.00'),
        sell('2024-03-10', '50', '50.00'),
      ],
      '45.00',
    );

    expect(realizadoMaisAberto).toBe(variacaoMenosAportes);
  });

  it('fecha com taxas na compra e na venda', () => {
    const { realizadoMaisAberto, variacaoMenosAportes } = identity(
      [
        buy('2024-01-10', '100', '30.00', '9.90'),
        sell('2024-03-10', '40', '45.00', '4.90'),
      ],
      '38.00',
    );

    expect(realizadoMaisAberto).toBe(variacaoMenosAportes);
  });

  it('fecha depois de um desdobramento, que não muda o custo total', () => {
    const { realizadoMaisAberto, variacaoMenosAportes } = identity(
      [
        buy('2024-01-10', '100', '30.00'),
        corporateEvent('2024-06-10', '1', '2'),
        sell('2024-07-10', '50', '18.00'),
      ],
      '16.00',
    );

    expect(realizadoMaisAberto).toBe(variacaoMenosAportes);
  });

  it('fecha com a posição zerada, quando o resultado aberto é zero', () => {
    const { realizadoMaisAberto, variacaoMenosAportes } = identity(
      [buy('2024-01-10', '100', '30.00'), sell('2024-03-10', '100', '45.00')],
      '45.00',
    );

    expect(realizadoMaisAberto).toBe(variacaoMenosAportes);
    expect(realizadoMaisAberto).toBe('1500.00');
  });

  it('fecha com prejuízo: a identidade não depende do sinal', () => {
    const { realizadoMaisAberto, variacaoMenosAportes } = identity(
      [buy('2024-01-10', '100', '30.00'), sell('2024-03-10', '40', '20.00')],
      '18.00',
    );

    expect(realizadoMaisAberto).toBe(variacaoMenosAportes);
    expect(Number(realizadoMaisAberto)).toBeLessThan(0);
  });
});
