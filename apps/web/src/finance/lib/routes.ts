/**
 * Todo caminho de Finanças é montado aqui. Nenhum componente escreve
 * `/financas/cartoes/${id}` à mão.
 */

export const FINANCE_SCREENS = [
  'visao-geral',
  'lancamentos',
  'contas',
  'cartoes',
  'recorrentes',
  'categorias',
  'configuracoes',
] as const;

export type FinanceScreen = (typeof FINANCE_SCREENS)[number];

const withSearch = (path: string, search?: string): string =>
  search === undefined || search === '' ? path : `${path}?${search}`;

/** NAV-01 · Telas planas, sem prefixo de área; a Visão geral é a raiz, no escopo Fluxo. */
export const financeRoutes = {
  home: (): string => '/?escopo=fluxo',
  overview: (): string => '/?escopo=fluxo',
  entries: (search?: string): string => withSearch('/lancamentos', search),
  accounts: (): string => '/contas',
  account: (id: string, search?: string): string =>
    withSearch(`/contas/${encodeURIComponent(id)}`, search),
  cards: (): string => '/cartoes',
  card: (id: string, invoice?: string): string =>
    `/cartoes/${encodeURIComponent(id)}${invoice === undefined ? '' : `?fatura=${invoice}`}`,
  recurrings: (): string => '/recorrentes',
  categories: (): string => '/categorias',
  settings: (): string => '/configuracoes',
} as const;

/**
 * A tela de navegação que fica destacada para um caminho. As telas de detalhe
 * destacam a tela de origem: o Extrato destaca Contas, e a Fatura destaca
 * Cartões.
 */
export const screenForPath = (pathname: string): FinanceScreen => {
  const first = pathname.split('/').filter((part) => part !== '')[0];
  if (first === 'configuracoes') return 'configuracoes';
  return (FINANCE_SCREENS as readonly string[]).includes(first ?? '') &&
    first !== 'visao-geral'
    ? (first as FinanceScreen)
    : 'visao-geral';
};
