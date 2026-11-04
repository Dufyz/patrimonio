import { describe, expect, it } from 'vitest';

import { PRIMARY_LABELS, pluralize } from './header.js';

describe('cabeçalho padrão', () => {
  it('o rótulo do botão principal muda por tela', () => {
    expect(PRIMARY_LABELS).toEqual({
      entries: 'Lançamento',
      accounts: 'Conta',
      cards: 'Cartão',
      recurrings: 'Recorrente',
      categories: 'Categoria',
    });
  });

  it('pluraliza contagens', () => {
    expect(pluralize(1, 'conta', 'contas')).toBe('1 conta');
    expect(pluralize(3, 'cartão', 'cartões')).toBe('3 cartões');
    expect(pluralize(0, 'conta', 'contas')).toBe('0 contas');
  });
});
