import type { AllocationLine, CompositionTarget } from '../../allocation/composition.js';

/**
 * Uma carteira de R$ 100 mil em dois grupos, para a conta de percentual ser
 * conferível de cabeça: cada R$ 1.000 é um ponto percentual.
 */
export const hundredThousand: readonly AllocationLine[] = [
  {
    category_id: 'cat-acoes',
    category_name: 'Ações',
    group_id: 'grp-variavel',
    group_name: 'Renda variável',
    value: '30000.00',
  },
  {
    category_id: 'cat-fii',
    category_name: 'FII',
    group_id: 'grp-variavel',
    group_name: 'Renda variável',
    value: '14000.00',
  },
  {
    category_id: 'cat-posfixado',
    category_name: 'Pós-fixado',
    group_id: 'grp-fixa',
    group_name: 'Renda fixa',
    value: '40000.00',
  },
  {
    category_id: 'cat-inflacao',
    category_name: 'Inflação',
    group_id: 'grp-fixa',
    group_name: 'Renda fixa',
    value: '10000.00',
  },
  {
    category_id: 'cat-caixa',
    category_name: 'Caixa',
    group_id: null,
    group_name: null,
    value: '6000.00',
  },
];

/** Alvo que fecha 100%: 45% em renda variável, 50% em renda fixa, 5% em caixa. */
export const closingTargets: readonly CompositionTarget[] = [
  { category_id: 'cat-acoes', target_pct: '30.00' },
  { category_id: 'cat-fii', target_pct: '15.00' },
  { category_id: 'cat-posfixado', target_pct: '35.00' },
  { category_id: 'cat-inflacao', target_pct: '15.00' },
  { category_id: 'cat-caixa', target_pct: '5.00' },
];

/** Alvo somando 96%: a tela precisa apontar os 4 pontos que faltam. */
export const incompleteTargets: readonly CompositionTarget[] = [
  { category_id: 'cat-acoes', target_pct: '30.00' },
  { category_id: 'cat-fii', target_pct: '15.00' },
  { category_id: 'cat-posfixado', target_pct: '35.00' },
  { category_id: 'cat-inflacao', target_pct: '15.00' },
  { category_id: 'cat-caixa', target_pct: '1.00' },
];

/** Alvo parcial: FII e caixa ficam sem alvo, e sem coluna de desvio. */
export const partialTargets: readonly CompositionTarget[] = [
  { category_id: 'cat-acoes', target_pct: '30.00' },
  { category_id: 'cat-posfixado', target_pct: '35.00' },
  { category_id: 'cat-inflacao', target_pct: '35.00' },
];
