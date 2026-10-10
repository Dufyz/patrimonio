/**
 * T-11 · O orçamento de consultas por rota.
 *
 * O banco fica em outra rede, então cada consulta que uma tela faz é uma ida e
 * volta paga por quem está olhando para ela. A regra é declarada aqui, rota por
 * rota, e o teste de `query-budget.routes.test.ts` falha ao passar dela.
 *
 * Os limites não são folga: cada um é o que a rota faz hoje. Subir um número é
 * decisão visível numa revisão — "esta tela passou a perguntar mais uma coisa"
 * —, e não efeito colateral de uma consulta nova que ninguém contou.
 */
export const SCREEN_QUERY_CEILING = 2;

export type RouteBudget = {
  /** Caminho sob `/api`, como o registro de `ROUTE_DOCS` o escreve. */
  readonly path: string;
  /** A tela que consome a rota. */
  readonly screen: string;
  /** O limite declarado. Nunca acima de `SCREEN_QUERY_CEILING`. */
  readonly max: number;
  /**
   * Quantas consultas o cenário semeado do teste deve alcançar. Garante que o
   * teste exercitou a rota inteira: uma rota que sai cedo por falta de dado
   * passaria no orçamento sem ter sido medida.
   */
  readonly reaches: number;
};

export const QUERY_BUDGETS: readonly RouteBudget[] = [
  { path: '/overview', screen: 'Visão geral', max: 2, reaches: 2 },
  { path: '/positions', screen: 'Posições', max: 2, reaches: 2 },
  { path: '/assets/:asset_id/page', screen: 'Ativo', max: 2, reaches: 2 },
  { path: '/statement', screen: 'Movimentações', max: 2, reaches: 2 },
  { path: '/performance', screen: 'Desempenho', max: 2, reaches: 2 },
  { path: '/allocation', screen: 'Estratégia', max: 1, reaches: 1 },
  { path: '/goals', screen: 'Objetivos', max: 1, reaches: 1 },
  { path: '/settings', screen: 'Configurações', max: 1, reaches: 1 },
  { path: '/search', screen: 'Busca global', max: 2, reaches: 2 },
];
