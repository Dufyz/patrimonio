/**
 * D-10 · O escopo na URL.
 *
 * `/longo-prazo/posicoes` é o endereço que alguém cola em outra aba, e por isso
 * o escopo aparece nele pelo nome da carteira, não pelo identificador. Voltar,
 * avançar e abrir em nova aba preservam a seleção porque ela nunca esteve em
 * estado de componente.
 *
 * Duas carteiras de nome parecido podem produzir o mesmo apelido. Em vez de
 * deixar a segunda inalcançável, o desempate acrescenta um número — a primeira
 * cadastrada fica com o apelido limpo, e o endereço de ninguém quebra.
 */

export type ScopePortfolio = { readonly id: string; readonly name: string };

export const slugify = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

export const portfolioSlugs = (
  portfolios: readonly ScopePortfolio[],
): ReadonlyMap<string, string> => {
  const used = new Map<string, number>();
  const slugs = new Map<string, string>();

  for (const portfolio of portfolios) {
    const base = slugify(portfolio.name) === '' ? 'carteira' : slugify(portfolio.name);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    slugs.set(portfolio.id, seen === 0 ? base : `${base}-${seen + 1}`);
  }

  return slugs;
};

/** O identificador que o escopo da URL nomeia. Apelido desconhecido dá nulo. */
export const portfolioIdForScope = (
  scope: string | undefined,
  slugs: ReadonlyMap<string, string>,
): string | null => {
  for (const [id, slug] of slugs) if (slug === scope) return id;
  return null;
};

/** O apelido da carteira na URL. Nulo quando a carteira não existe. */
export const scopeForPortfolioId = (
  id: string,
  slugs: ReadonlyMap<string, string>,
): string | null => slugs.get(id) ?? null;
