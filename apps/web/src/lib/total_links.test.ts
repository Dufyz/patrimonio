import { describe, expect, it } from 'vitest';

import { filtersFromParams } from './ledger_filters.js';
import { totalLink, type TotalTarget } from './total_links.js';

const paramsOf = (url: string): URLSearchParams =>
  new URLSearchParams(url.split('?')[1] ?? '');

describe('NAV-12 · totalLink', () => {
  it('Receitas e Despesas abrem Lançamentos filtrados por tipo, situação e período', () => {
    for (const [kind, tipo] of [
      ['receitas', 'RECEITA'],
      ['despesas', 'DESPESA'],
    ] as const) {
      const url = totalLink({ kind, month: '2026-11' });
      expect(url.startsWith('/lancamentos?')).toBe(true);
      const params = paramsOf(url);
      expect(filtersFromParams(params)).toMatchObject({
        tipo: [tipo],
        situacao: ['lancado'],
      });
      expect(params.get('mes')).toBe('2026-11');
    }
  });

  it('aportes e aportes previstos diferem na situação', () => {
    const done = filtersFromParams(
      paramsOf(totalLink({ kind: 'aportes', month: '2026-11' })),
    );
    const planned = filtersFromParams(
      paramsOf(totalLink({ kind: 'aportes', month: '2026-11', planned: true })),
    );
    expect(done).toMatchObject({ tipo: ['APORTE'], situacao: ['lancado'] });
    expect(planned).toMatchObject({ tipo: ['APORTE'], situacao: ['previsto'] });
  });

  it('A lançar filtra pela situação Previsto', () => {
    expect(filtersFromParams(paramsOf(totalLink({ kind: 'a_lancar' })))).toMatchObject({
      situacao: ['previsto'],
    });
  });

  it('categoria abre Lançamentos agrupado por categoria', () => {
    const params = paramsOf(
      totalLink({ kind: 'categoria', category: 'c1', month: '2026-10' }),
    );
    expect(params.get('categoria')).toBe('c1');
    expect(params.get('agrupar')).toBe('categoria');
    expect(params.get('mes')).toBe('2026-10');
  });

  it('carteiras, contas, faturas, classe e posição vão para a lista que as compõe', () => {
    const cases: ReadonlyArray<readonly [TotalTarget, string]> = [
      [{ kind: 'carteiras' }, '/?escopo=investimentos'],
      [{ kind: 'carteiras', scope: 'longo' }, '/carteiras/longo/posicoes'],
      [{ kind: 'contas' }, '/contas'],
      [{ kind: 'contas', account: 'a1' }, '/contas/a1'],
      [{ kind: 'faturas' }, '/cartoes'],
      [{ kind: 'faturas', card: 'k1' }, '/cartoes/k1'],
      [{ kind: 'faturas', card: 'k1', invoice: '2026-11' }, '/cartoes/k1?fatura=2026-11'],
      [
        { kind: 'classe', classId: 'acoes', scope: 'longo' },
        '/carteiras/longo/posicoes?classe=acoes',
      ],
      [
        { kind: 'posicao', slug: 'itub4', scope: 'longo' },
        '/carteiras/longo/ativos/itub4',
      ],
    ];
    for (const [target, expected] of cases) expect(totalLink(target)).toBe(expected);
  });
});
