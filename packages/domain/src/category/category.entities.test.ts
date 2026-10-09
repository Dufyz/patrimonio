import { describe, expect, it } from 'vitest';

import { classifyAsset, isColorToken } from './category.entities.js';
import type { Category } from './category.entities.js';

const categoria = (
  name: string,
  auto_rule: Record<string, unknown> | null,
  sort_order = 0,
): Category => ({
  id: name,
  parent_id: null,
  name,
  color_token: 'class.stock',
  auto_rule,
  sort_order,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
});

describe('cor da categoria', () => {
  it('token do design system é aceito e hex não', () => {
    expect(isColorToken('class.fii')).toBe(true);
    expect(isColorToken('class.rf-inflacao')).toBe(true);
    expect(isColorToken('#2563eb')).toBe(false);
    expect(isColorToken('azul')).toBe(false);
  });
});

describe('classificação automática', () => {
  const categorias = [
    categoria('FIIs', { b3_type: 'fii' }, 1),
    categoria('RF inflação', { indexer: 'ipca_plus' }, 2),
    categoria('Ações', { b3_type: 'stock' }, 3),
    categoria('Sem regra', null, 4),
  ];

  it('ativo novo cai na categoria cuja regra ele cumpre', () => {
    expect(classifyAsset({ b3_type: 'fii' }, categorias)?.name).toBe('FIIs');
    expect(classifyAsset({ indexer: 'ipca_plus' }, categorias)?.name).toBe('RF inflação');
  });

  it('ativo que não cumpre regra nenhuma fica sem categoria, em vez de cair em uma qualquer', () => {
    expect(classifyAsset({ b3_type: 'bdr' }, categorias)).toBeNull();
  });

  it('regra com duas condições exige as duas', () => {
    const lista = [
      categoria('RF pós do banco', { indexer: 'cdi_pct', origin: 'manual' }),
    ];

    expect(classifyAsset({ indexer: 'cdi_pct' }, lista)).toBeNull();
    expect(classifyAsset({ indexer: 'cdi_pct', origin: 'manual' }, lista)?.name).toBe(
      'RF pós do banco',
    );
  });

  it('duas regras que casam têm vencedor previsível: a ordem de exibição', () => {
    const lista = [
      categoria('Depois', { b3_type: 'fii' }, 9),
      categoria('Antes', { b3_type: 'fii' }, 1),
    ];

    expect(classifyAsset({ b3_type: 'fii' }, lista)?.name).toBe('Antes');
  });

  it('regra vazia não classifica nada', () => {
    expect(classifyAsset({ b3_type: 'fii' }, [categoria('Tudo', {})])).toBeNull();
  });

  it('chave desconhecida na regra não classifica', () => {
    expect(
      classifyAsset({ b3_type: 'fii' }, [categoria('X', { cor: 'azul' })]),
    ).toBeNull();
  });
});
