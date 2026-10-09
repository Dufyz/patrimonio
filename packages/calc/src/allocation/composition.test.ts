import { describe, expect, it } from 'vitest';

import {
  closingTargets,
  hundredThousand,
  incompleteTargets,
  partialTargets,
} from '../__fixtures__/allocation/composition.js';
import { composeAllocation, outOfTolerance } from './composition.js';

const composition = composeAllocation(hundredThousand, closingTargets, {
  tolerance_pp: '3',
});

const node = (id: string) => {
  for (const root of composition.nodes) {
    if (root.id === id) return root;
    const child = root.children.find((candidate) => candidate.id === id);
    if (child !== undefined) return child;
  }
  return undefined;
};

describe('o grupo é a soma das categorias', () => {
  it('o valor do grupo é a soma dos filhos, não um número guardado em paralelo', () => {
    expect(node('grp-fixa')?.value).toBe('50000.00');
    expect(node('grp-variavel')?.value).toBe('44000.00');
    expect(composition.total).toBe('100000.00');
  });

  it('o alvo do grupo é a soma dos alvos das categorias dentro dele', () => {
    expect(node('grp-fixa')?.target_pct).toBe('50.00');
    expect(node('grp-variavel')?.target_pct).toBe('45.00');
  });

  it('a composição dos grupos e das categorias soltas fecha o total', () => {
    const roots = composition.nodes.reduce(
      (total, root) => total + Number(root.value),
      0,
    );

    expect(roots).toBe(Number(composition.total));
  });

  it('categoria sem grupo entra na raiz como ela mesma', () => {
    const caixa = composition.nodes.find((root) => root.id === 'cat-caixa');

    expect(caixa?.level).toBe('category');
    expect(caixa?.children).toEqual([]);
  });

  it('as linhas vêm ordenadas pelo valor, maior primeiro', () => {
    expect(composition.nodes.map((root) => root.id)).toEqual([
      'grp-fixa',
      'grp-variavel',
      'cat-caixa',
    ]);
    expect(node('grp-fixa')?.children.map((child) => child.id)).toEqual([
      'cat-posfixado',
      'cat-inflacao',
    ]);
  });
});

describe('desvio contra o alvo', () => {
  it('sai em pontos percentuais, com sinal', () => {
    expect(node('cat-posfixado')?.current_pct).toBe('40.00');
    expect(node('cat-posfixado')?.deviation_pp).toBe('5.00');

    expect(node('cat-inflacao')?.current_pct).toBe('10.00');
    expect(node('cat-inflacao')?.deviation_pp).toBe('-5.00');
  });

  it('diz quanto mover para chegar ao alvo: positivo é comprar', () => {
    expect(node('cat-inflacao')?.amount_to_move).toBe('5000.00');
    expect(node('cat-posfixado')?.amount_to_move).toBe('-5000.00');
  });

  it('traz o valor que a linha teria no alvo, para a tela não somar', () => {
    expect(node('cat-inflacao')?.target_value).toBe('15000.00');
    expect(node('cat-posfixado')?.target_value).toBe('35000.00');
    expect(node('grp-fixa')?.target_value).toBe('50000.00');
  });

  it('desvio acima da tolerância da carteira fica marcado', () => {
    expect(node('cat-posfixado')?.over_tolerance).toBe(true);
    expect(node('cat-inflacao')?.over_tolerance).toBe(true);
    expect(node('cat-caixa')?.over_tolerance).toBe(false);
    expect(node('grp-fixa')?.over_tolerance).toBe(false);
  });

  it('as linhas fora da tolerância saem ordenadas pelo tamanho do desvio', () => {
    expect(outOfTolerance(composition).map((line) => line.id)).toEqual([
      'cat-posfixado',
      'cat-inflacao',
    ]);
  });

  it('sem tolerância declarada nada é marcado', () => {
    const semTolerancia = composeAllocation(hundredThousand, closingTargets);

    expect(outOfTolerance(semTolerancia)).toEqual([]);
  });
});

describe('alvo ausente ou incompleto', () => {
  it('categoria sem alvo mostra composição real e coluna de desvio vazia', () => {
    const parcial = composeAllocation(hundredThousand, partialTargets);
    const fii = parcial.nodes
      .flatMap((root) => [root, ...root.children])
      .find((line) => line.id === 'cat-fii');

    expect(fii?.current_pct).toBe('14.00');
    expect(fii?.target_pct).toBeNull();
    expect(fii?.deviation_pp).toBeNull();
    expect(fii?.amount_to_move).toBeNull();
    expect(fii?.target_value).toBeNull();
    expect(fii?.over_tolerance).toBe(false);
  });

  it('o grupo em que nenhuma categoria tem alvo também não tem alvo', () => {
    const semAlvo = composeAllocation(hundredThousand, [
      { category_id: 'cat-posfixado', target_pct: '100.00' },
    ]);
    const variavel = semAlvo.nodes.find((root) => root.id === 'grp-variavel');

    expect(variavel?.target_pct).toBeNull();
    expect(variavel?.deviation_pp).toBeNull();
  });

  it('alvo somando 96% é rejeitado, e a diferença que falta é apontada', () => {
    const incompleta = composeAllocation(hundredThousand, incompleteTargets);

    expect(incompleta.target_sum.total_pct).toBe('96.00');
    expect(incompleta.target_sum.missing_pp).toBe('4.00');
    expect(incompleta.target_rejected).toBe(true);
  });

  it('alvo fechando 100% é aceito, e nenhum alvo também é um estado legítimo', () => {
    expect(composition.target_rejected).toBe(false);
    expect(composeAllocation(hundredThousand, []).target_rejected).toBe(false);
  });
});

describe('casos limite', () => {
  it('carteira vazia devolve zero em vez de dividir por zero', () => {
    const vazia = composeAllocation([], closingTargets);

    expect(vazia.total).toBe('0.00');
    expect(vazia.nodes).toEqual([]);
  });

  it('carteira com valor zero não produz percentual NaN', () => {
    const zerada = composeAllocation(
      [
        {
          category_id: 'cat-acoes',
          category_name: 'Ações',
          group_id: null,
          group_name: null,
          value: '0.00',
        },
      ],
      [{ category_id: 'cat-acoes', target_pct: '100.00' }],
    );

    expect(zerada.nodes[0]?.current_pct).toBe('0.00');
    expect(zerada.nodes[0]?.deviation_pp).toBe('-100.00');
    expect(zerada.nodes[0]?.amount_to_move).toBe('0.00');
  });

  it('grupo sem nome usa o próprio identificador em vez de ficar em branco', () => {
    const semNome = composeAllocation(
      [
        {
          category_id: 'cat-x',
          category_name: 'X',
          group_id: 'grp-x',
          group_name: null,
          value: '100.00',
        },
      ],
      [],
    );

    expect(semNome.nodes[0]?.name).toBe('grp-x');
  });
});
