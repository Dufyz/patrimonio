/**
 * D-01 · O registro de token de cor.
 *
 * `category.color_token` guarda `class.acoes`, nunca um hexadecimal — é o que
 * garante que Ações tenha a mesma cor na tabela de Posições, na fatia da barra
 * de composição e na linha do gráfico. Este módulo é a única tradução de token
 * para cor, e ela devolve `var(--...)`: o valor em si continua no tema.
 *
 * Um token desconhecido — categoria criada à mão com um nome que o design não
 * previu — cai em `class.outros` em vez de sumir do gráfico.
 */

export const CLASS_COLOR_TOKENS = [
  'class.rf-pos',
  'class.rf-inflacao',
  'class.rf-pre',
  'class.acoes',
  'class.fiis',
  'class.caixa',
  'class.etf',
  'class.bdr',
  'class.outros',
] as const;

export type ClassColorToken = (typeof CLASS_COLOR_TOKENS)[number];

export const FALLBACK_COLOR_TOKEN: ClassColorToken = 'class.outros';

export const isClassColorToken = (value: unknown): value is ClassColorToken =>
  typeof value === 'string' && (CLASS_COLOR_TOKENS as readonly string[]).includes(value);

/** `class.acoes` → `var(--color-class-acoes)`. */
export const colorForToken = (token: string | null | undefined): string => {
  const known = isClassColorToken(token) ? token : FALLBACK_COLOR_TOKEN;
  return `var(--color-${known.replace('.', '-')})`;
};

/**
 * As seis cores de série, na ordem em que são distribuídas. A série da própria
 * carteira é sempre a primeira; benchmark tem cor própria e traço tracejado,
 * para não disputar atenção com ela.
 */
export const SERIES_COLORS = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
  'var(--color-series-6)',
] as const;

export const BENCHMARK_COLOR = 'var(--color-series-benchmark)';

export const colorForSeries = (index: number): string =>
  SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];

/** Papéis semânticos usados fora de classe e série. */
export const SEMANTIC_COLORS = {
  positive: 'var(--color-positive)',
  negative: 'var(--color-negative)',
  attention: 'var(--color-attention)',
  accent: 'var(--color-accent)',
  ink: 'var(--color-ink)',
  ink2: 'var(--color-ink-2)',
  ink3: 'var(--color-ink-3)',
  line: 'var(--color-line)',
  panel: 'var(--color-panel)',
  contributions: 'var(--color-area-contributions)',
  return: 'var(--color-area-return)',
  loss: 'var(--color-area-loss)',
} as const;
