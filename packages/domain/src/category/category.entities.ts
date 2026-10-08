/**
 * Dois níveis: grupo (`parent_id` nulo) e categoria. O grupo é a soma das
 * categorias dentro dele, e isso é restrição do banco, não convenção: a
 * primeira árvore de três níveis quebraria todo subtotal de Posições, e o lugar
 * em que isso aparece é o número na tela.
 */
export type Category = {
  readonly id: string;
  readonly parent_id: string | null;
  readonly name: string;
  /**
   * Token do design system, não hex: a cor de uma classe precisa ser a mesma na
   * tabela, no gráfico e na barra de alocação, nos dois temas.
   */
  readonly color_token: string;
  /** Ex.: `{"indexer":"ipca_plus"}` ou `{"b3_type":"fii"}`. */
  readonly auto_rule: Record<string, unknown> | null;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
};

/** `class.stock`, `class.fii`, `class.cash` — nunca `#2563eb`. */
const COLOR_TOKEN = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;

export const isColorToken = (value: unknown): value is string =>
  typeof value === 'string' && COLOR_TOKEN.test(value);

/**
 * Os atributos do ativo que uma regra automática pode olhar. Fechar a lista é
 * o que impede uma regra de depender de um campo que o ativo não carrega.
 */
export type ClassifiableAsset = {
  readonly b3_type?: string | null | undefined;
  readonly indexer?: string | null | undefined;
  readonly origin?: string | null | undefined;
  readonly sector?: string | null | undefined;
};

const RULE_KEYS = ['b3_type', 'indexer', 'origin', 'sector'] as const;

type RuleKey = (typeof RULE_KEYS)[number];

export const isRuleKey = (value: string): value is RuleKey =>
  (RULE_KEYS as readonly string[]).includes(value);

const matches = (rule: Record<string, unknown>, asset: ClassifiableAsset): boolean => {
  const entries = Object.entries(rule);
  if (entries.length === 0) return false;

  // Toda condição declarada precisa bater: regra com duas chaves é "e", não
  // "ou". Uma regra que casasse por qualquer chave classificaria ação como
  // renda fixa no dia em que alguém acrescentasse um campo.
  return entries.every(([key, expected]) => {
    if (!isRuleKey(key)) return false;
    const actual = asset[key];
    return actual !== null && actual !== undefined && String(actual) === String(expected);
  });
};

/**
 * A categoria em que um ativo novo cai. A ordem de exibição desempata, então
 * duas regras que casam têm um vencedor previsível em vez de depender da ordem
 * em que as categorias foram criadas.
 */
export const classifyAsset = (
  asset: ClassifiableAsset,
  categories: readonly Category[],
): Category | null => {
  const candidates = categories
    .filter(
      (category) => category.auto_rule !== null && matches(category.auto_rule, asset),
    )
    .sort((left, right) =>
      left.sort_order === right.sort_order
        ? left.name.localeCompare(right.name)
        : left.sort_order - right.sort_order,
    );

  return candidates[0] ?? null;
};
