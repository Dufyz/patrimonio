import { describe, expect, it } from 'vitest';

import {
  portfolioIdForScope,
  portfolioSlugs,
  scopeForPortfolioId,
  slugify,
} from './scope.js';

describe('escopo na URL', () => {
  it('o nome da carteira vira endereço legível', () => {
    expect(slugify('Longo prazo')).toBe('longo-prazo');
    expect(slugify('Entrada do imóvel')).toBe('entrada-do-imovel');
  });

  it('duas carteiras de mesmo apelido não deixam a segunda inalcançável', () => {
    const slugs = portfolioSlugs([
      { id: '1', name: 'Reserva' },
      { id: '2', name: 'reserva' },
    ]);

    expect(slugs.get('1')).toBe('reserva');
    expect(slugs.get('2')).toBe('reserva-2');
    expect(portfolioIdForScope('reserva-2', slugs)).toBe('2');
  });

  it('carteira de nome sem letra nenhuma ainda ganha endereço', () => {
    const slugs = portfolioSlugs([{ id: '1', name: '— ⚑ —' }]);
    expect(slugs.get('1')).toBe('carteira');
  });

  it('um apelido desconhecido não nomeia carteira nenhuma', () => {
    const slugs = portfolioSlugs([{ id: '1', name: 'Longo prazo' }]);

    expect(portfolioIdForScope('todas', slugs)).toBeNull();
    expect(portfolioIdForScope('inexistente', slugs)).toBeNull();
    expect(portfolioIdForScope(undefined, slugs)).toBeNull();
    expect(portfolioIdForScope('longo-prazo', slugs)).toBe('1');
  });

  it('o caminho de volta devolve o mesmo apelido', () => {
    const slugs = portfolioSlugs([{ id: '1', name: 'Longo prazo' }]);

    expect(scopeForPortfolioId('1', slugs)).toBe('longo-prazo');
    expect(scopeForPortfolioId('99', slugs)).toBeNull();
  });
});
