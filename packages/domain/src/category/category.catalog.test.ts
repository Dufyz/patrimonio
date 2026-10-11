import { describe, expect, it } from 'vitest';

import { CATEGORY_CATALOG, CATEGORY_IDS, fixedIncomeCategoryId } from './category.catalog.js';
import { classifyAsset, isColorToken } from './category.entities.js';
import type { Category } from './category.entities.js';

const asCategories = (): Category[] =>
  CATEGORY_CATALOG.map((item) => ({
    ...item,
    parent_id: null,
    auto_rule: item.auto_rule === null ? null : { ...item.auto_rule },
    created_at: '2024-01-02T12:00:00Z',
    updated_at: '2024-01-02T12:00:00Z',
  }));

describe('o catálogo de categorias da plataforma', () => {
  it('tem as 30 categorias, sem id nem nome repetido', () => {
    expect(CATEGORY_CATALOG).toHaveLength(30);
    expect(new Set(CATEGORY_CATALOG.map((item) => item.id)).size).toBe(30);
    expect(new Set(CATEGORY_CATALOG.map((item) => item.name.toLowerCase())).size).toBe(30);
  });

  it('só usa tokens de cor do design system', () => {
    for (const item of CATEGORY_CATALOG) expect(isColorToken(item.color_token)).toBe(true);
  });

  it('a ordem de exibição segue a ordem do catálogo', () => {
    const orders = CATEGORY_CATALOG.map((item) => item.sort_order);
    expect(orders).toEqual([...orders].sort((left, right) => left - right));
  });

  it('o ativo de mercado cai na categoria da regra do tipo da B3', () => {
    const categories = asCategories();
    const nameOf = (b3_type: string): string | undefined =>
      classifyAsset({ b3_type }, categories)?.name;

    expect(nameOf('stock')).toBe('Ações / Units');
    expect(nameOf('fii')).toBe('FIIs');
    expect(nameOf('etf')).toBe('ETFs');
    expect(nameOf('bdr')).toBe('BDR');
    expect(nameOf('treasury')).toBe('Tesouro Direto');
    expect(nameOf('cash')).toBe('Caixa');
  });

  it('o título de renda fixa cadastrado à mão cai na categoria do tipo dele', () => {
    const nameOf = (kind: string): string | undefined =>
      CATEGORY_CATALOG.find((item) => item.id === fixedIncomeCategoryId(kind))?.name;

    expect(nameOf('cdb')).toBe('CDB');
    expect(nameOf('lci')).toBe('LCA / LCI / LCD');
    expect(nameOf('lca')).toBe('LCA / LCI / LCD');
    expect(nameOf('cri')).toBe('CRI / CRA');
    expect(nameOf('cra')).toBe('CRI / CRA');
    expect(nameOf('debenture')).toBe('Debêntures');
    expect(nameOf('outro')).toBe('Ativos Personalizados');
    expect(fixedIncomeCategoryId('qualquer')).toBe(CATEGORY_IDS.customAssets);
  });
});
