/**
 * Todo caminho de Finanças é montado aqui. Nenhum componente escreve
 * `/financas/cartoes/${id}` à mão.
 */

export const FINANCE_ROOT = '/financas';

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

export const financeRoutes = {
  home: (): string => `${FINANCE_ROOT}/visao-geral`,
  overview: (): string => `${FINANCE_ROOT}/visao-geral`,
  entries: (search?: string): string =>
    `${FINANCE_ROOT}/lancamentos${search === undefined || search === '' ? '' : `?${search}`}`,
  accounts: (): string => `${FINANCE_ROOT}/contas`,
  account: (id: string, search?: string): string =>
    `${FINANCE_ROOT}/contas/${encodeURIComponent(id)}${
      search === undefined || search === '' ? '' : `?${search}`
    }`,
  cards: (): string => `${FINANCE_ROOT}/cartoes`,
  card: (id: string, invoice?: string): string =>
    `${FINANCE_ROOT}/cartoes/${encodeURIComponent(id)}${
      invoice === undefined ? '' : `?fatura=${invoice}`
    }`,
  recurrings: (): string => `${FINANCE_ROOT}/recorrentes`,
  categories: (): string => `${FINANCE_ROOT}/categorias`,
  settings: (): string => `${FINANCE_ROOT}/configuracoes`,
  /** A área de Investimentos, para o seletor de área. */
  investments: (): string => '/todas/visao-geral',
} as const;

/**
 * A tela de navegação que fica destacada para um caminho. As telas de detalhe
 * destacam a tela de origem: o Extrato destaca Contas, e a Fatura destaca
 * Cartões.
 */
export const screenForPath = (pathname: string): FinanceScreen => {
  const segment = pathname.split('/').filter((part) => part !== '')[1];
  return (FINANCE_SCREENS as readonly string[]).includes(segment ?? '')
    ? (segment as FinanceScreen)
    : 'visao-geral';
};
