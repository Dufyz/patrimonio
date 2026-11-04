/**
 * FIN-702 · Prioridade de coluna. Em larguras menores as colunas de menor
 * prioridade somem, em quatro níveis, para a tabela nunca rolar na horizontal.
 * Descrição, valor e ação principal da linha não têm nível: nunca somem.
 *
 * Nível 1 some primeiro (abaixo de 1280px) e nível 4 por último (abaixo de 640px).
 * As classes são literais para o Tailwind encontrá-las.
 */

export type HideLevel = 1 | 2 | 3 | 4;

const CLASSES: Readonly<Record<HideLevel, string>> = {
  1: 'max-xl:hidden',
  2: 'max-lg:hidden',
  3: 'max-md:hidden',
  4: 'max-sm:hidden',
};

export const hideBelow = (level: HideLevel): string => CLASSES[level];

/** A ordem proposta, da primeira coluna a sumir para a última, por tela. */
export const COLUMN_PRIORITY = {
  lancamentos: { detalhe: 1, conta: 2, categoria: 3 },
  contas: { cartao: 1, variacao: 2 },
  cartoes: { limite: 1, vence: 2 },
  extrato: { categoria: 1, saldoApos: 2 },
  recorrentes: { lancamento: 1, pagamento: 2, dia: 3 },
  categorias: { media: 1, lancamentos: 2 },
} as const satisfies Readonly<Record<string, Readonly<Record<string, HideLevel>>>>;
