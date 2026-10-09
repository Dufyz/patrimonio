import { describe, expect, it } from 'vitest';

import { modifiedDietz } from './dietz.js';

const base = {
  start_date: '2026-01-01',
  end_date: '2026-01-31',
  income: '0.00',
} as const;

describe('Dietz modificado', () => {
  it('sem fluxo é a variação simples do valor', () => {
    expect(
      modifiedDietz({ ...base, start_value: '1000.00', end_value: '1100.00', flows: [] }),
    ).toBe('10.00');
  });

  it('o aporte não é rendimento: o valor subiu só pelo que entrou', () => {
    // 1000 → 1500 com 500 aportados no meio do período e nada de mercado.
    expect(
      modifiedDietz({
        ...base,
        start_value: '1000.00',
        end_value: '1500.00',
        flows: [{ date: '2026-01-16', amount: '500.00' }],
      }),
    ).toBe('0.00');
  });

  it('o fluxo pesa pelo tempo em que esteve na classe', () => {
    // Capital = 1000 + 500 × (15/30) = 1250. Rendimento = 1650 − 1000 − 500 = 150.
    expect(
      modifiedDietz({
        ...base,
        start_value: '1000.00',
        end_value: '1650.00',
        flows: [{ date: '2026-01-16', amount: '500.00' }],
      }),
    ).toBe('12.00');
  });

  it('compra na véspera do fim quase não dilui o retorno', () => {
    // Capital = 1000 + 1000 × (1/30). Rendimento = 2150 − 1000 − 1000 = 150.
    expect(
      modifiedDietz({
        ...base,
        start_value: '1000.00',
        end_value: '2150.00',
        flows: [{ date: '2026-01-30', amount: '1000.00' }],
      }),
    ).toBe('14.52');
  });

  it('o provento é resultado da classe, não fluxo', () => {
    expect(
      modifiedDietz({
        ...base,
        start_value: '1000.00',
        end_value: '1000.00',
        income: '50.00',
        flows: [],
      }),
    ).toBe('5.00');
  });

  it('venda é fluxo negativo: o valor que saiu não é prejuízo', () => {
    // 1000 → 600 com 500 vendidos no meio e 100 de ganho sobre o que ficou.
    // Capital = 1000 − 500 × (15/30) = 750. Rendimento = 600 − 1000 + 500 = 100.
    expect(
      modifiedDietz({
        ...base,
        start_value: '1000.00',
        end_value: '600.00',
        flows: [{ date: '2026-01-16', amount: '-500.00' }],
      }),
    ).toBe('13.33');
  });

  it('classe aberta dentro do período tem capital pelos fluxos', () => {
    // Começa vazia, recebe 1000 no dia 11 e termina valendo 1100.
    expect(
      modifiedDietz({
        ...base,
        start_value: '0.00',
        end_value: '1100.00',
        flows: [{ date: '2026-01-11', amount: '1000.00' }],
      }),
    ).toBe('15.00');
  });

  it('sem capital no período não há retorno, e isso não é zero', () => {
    expect(
      modifiedDietz({ ...base, start_value: '0.00', end_value: '0.00', flows: [] }),
    ).toBeNull();
  });

  it('período que não existe não tem retorno', () => {
    expect(
      modifiedDietz({
        start_date: '2026-01-31',
        end_date: '2026-01-31',
        start_value: '1000.00',
        end_value: '1100.00',
        income: '0.00',
        flows: [],
      }),
    ).toBeNull();
  });

  it('fluxo fora do período é ignorado', () => {
    expect(
      modifiedDietz({
        ...base,
        start_value: '1000.00',
        end_value: '1100.00',
        flows: [
          { date: '2025-12-15', amount: '900.00' },
          { date: '2026-02-10', amount: '900.00' },
        ],
      }),
    ).toBe('10.00');
  });
});
