/**
 * FIN-002 · O vocabulário do cabeçalho padrão.
 *
 * O rótulo do botão principal muda por tela, e o resto do cabeçalho não.
 */

export const PRIMARY_LABELS = {
  entries: 'Lançamento',
  accounts: 'Conta',
  cards: 'Cartão',
  recurrings: 'Recorrente',
  categories: 'Categoria',
} as const;

export type PrimaryScreen = keyof typeof PRIMARY_LABELS;

/** `1 conta`, `3 contas`. Zero é plural, como na fala. */
export const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;
