import { describe, expect, it } from 'vitest';

import { financeSearchItems, searchFinance, valueInCents } from './search.js';
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

describe('busca por valor e destinos (NAV-09)', () => {
  it('valueInCents lê o valor com ou sem formatação', () => {
    expect(valueInCents('1234,56')).toBe(123_456);
    expect(valueInCents('1.234,56')).toBe(123_456);
    expect(valueInCents('R$ 1.234,56')).toBe(123_456);
    expect(valueInCents('1234.56')).toBe(123_456);
    expect(valueInCents('89,9')).toBe(8_990);
    expect(valueInCents('1500')).toBe(150_000);
    expect(valueInCents('spotify')).toBeNull();
    expect(valueInCents('')).toBeNull();
  });

  it('acha o lançamento pelo valor, com e sem formatação', () => {
    const amount = Math.abs(
      data.entries.find((entry) => entry.historical !== true)?.cents ?? 0,
    );
    const reais = Math.floor(amount / 100);
    const centavos = String(amount % 100).padStart(2, '0');
    const plain = `${reais}.${centavos}`;
    const br = `R$ ${reais.toLocaleString('pt-BR')},${centavos}`;
    for (const text of [plain, br]) {
      const group = find(text).find((g) => g.id === 'lancamentos');
      expect(group?.items.length, text).toBeGreaterThan(0);
    }
  });

  it('a categoria abre Lançamentos agrupado por categoria', () => {
    const category = find('saúde').find((g) => g.id === 'categorias');
    expect(category?.items[0]?.to).toBe('/lancamentos?agrupar=categoria');
  });

  it('o grupo cheio traz o total e a paleta ganha "Ver todos" com a busca aplicada', () => {
    const group = find('a').find((g) => g.id === 'lancamentos');
    expect(group?.items.length).toBeLessThanOrEqual(5);
    expect(group?.total).toBeGreaterThanOrEqual(group?.items.length ?? 0);
    const items = financeSearchItems(data, 'a', SEED_REFERENCE_DATE);
    if ((group?.total ?? 0) > 5) {
      const all = items.find((item) => item.id.endsWith(':ver-todos'));
      expect(all?.label).toMatch(/^Ver todos os \d+ lançamentos$/);
      expect(all?.target).toEqual({
        kind: 'path',
        path: '/lancamentos?busca=a',
      });
    }
  });
});
