import { describe, expect, it } from 'vitest';

import { categoryUsage } from './categories.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';
import type { Entry } from './types.js';

const TODAY = SEED_REFERENCE_DATE;
const { entries } = seedData();
const usage = (id: string) => categoryUsage(entries, id, TODAY);

describe('uso das categorias na semente (prancha 06, com as regras do documento)', () => {
  it('conta só lançados do mês corrente', () => {
    expect(usage('moradia')).toMatchObject({ count: 3, total: 356240 });
    expect(usage('saude')).toMatchObject({ count: 3, total: 90580 });
    expect(usage('transporte')).toMatchObject({ count: 1, total: 45400 });
    expect(usage('investimento')).toMatchObject({ count: 1, total: 450000 });
    expect(usage('salario')).toMatchObject({ count: 1, total: 1420000 });
    expect(usage('freelas')).toMatchObject({ count: 1, total: 180000 });
    expect(usage('reembolso')).toMatchObject({ count: 1, total: 35000 });
  });

  it('previsto fica de fora: Spotify previsto não entra em Assinaturas', () => {
    expect(usage('assinaturas')).toMatchObject({ count: 1, total: 5590 });
    expect(usage('gasto-livre')).toMatchObject({ count: 0, total: 0 });
  });

  it('a média usa os 12 meses completos anteriores', () => {
    expect(usage('moradia').average12).toBe(341000);
    expect(usage('saude').average12).toBe(88015);
    expect(usage('mercado').average12).toBe(148235);
    expect(usage('salario').average12).toBe(1420000);
  });
});

describe('janela da média', () => {
  const posted = (date: string, cents: number): Entry => ({
    id: date,
    kind: 'despesa',
    date,
    description: 'x',
    categoryId: 'c',
    cents,
    status: 'lancada',
    payments: [],
  });

  it('exclui o mês corrente e o mês de 13 meses atrás', () => {
    const list = [
      posted('2026-10-02', 99900), // mês corrente
      posted('2025-09-30', 99900), // 13 meses atrás
      posted('2025-10-01', 1200), // primeiro dia da janela
      posted('2026-09-30', 2400), // último dia da janela
    ];
    expect(categoryUsage(list, 'c', TODAY).average12).toBe(300);
  });

  it('arredonda para o centavo mais próximo', () => {
    expect(categoryUsage([posted('2026-09-10', 1)], 'c', TODAY).average12).toBe(0);
    expect(categoryUsage([posted('2026-09-10', 6)], 'c', TODAY).average12).toBe(1);
  });
});
