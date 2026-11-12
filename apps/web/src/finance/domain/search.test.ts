import { describe, expect, it } from 'vitest';

import { searchFinance } from './search.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';

const data = seedData();
const find = (query: string) => searchFinance(data, query, SEED_REFERENCE_DATE);

describe('busca global (FIN-703)', () => {
  it('consulta vazia não acha nada', () => {
    expect(find('  ')).toEqual([]);
  });

  it('agrupa por Lançamentos, Contas, Cartões, Recorrentes e Categorias, nessa ordem', () => {
    const groups = find('itaú');
    expect(groups.map((g) => g.title)).toEqual(['Contas', 'Cartões']);
    expect(groups[0]?.items.map((i) => i.label)).toContain('Itaú Corrente');
    expect(groups[1]?.items.map((i) => i.label)).toEqual([
      'Itaú Visa',
      'Itaú Mastercard',
    ]);
  });

  it('ignora acento e caixa', () => {
    expect(find('SAUDE').some((g) => g.id === 'categorias')).toBe(true);
  });

  it('cada resultado leva à tela certa', () => {
    const [account] = find('carteira').filter((g) => g.id === 'contas');
    expect(account?.items[0]?.to).toBe('/contas/carteira');
    const [card] = find('nubank mastercard').filter((g) => g.id === 'cartoes');
    expect(card?.items[0]?.to).toBe('/cartoes/nubank-master');
  });

  it('o lançamento abre Lançamentos com a busca aplicada, sem o histórico', () => {
    const entries = find('spotify').find((g) => g.id === 'lancamentos');
    expect(entries?.items[0]?.to).toContain('/lancamentos?busca=Spotify');
    expect(find('histórico').find((g) => g.id === 'lancamentos')).toBeUndefined();
  });

  it('no máximo cinco por grupo', () => {
    for (const group of find('a')) expect(group.items.length).toBeLessThanOrEqual(5);
  });
});
