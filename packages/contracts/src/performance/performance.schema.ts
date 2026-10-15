import { parseBenchmark } from '@patrimonio/domain';
import { z } from 'zod';

import { dateOnly, decimalString, uuid } from '../support/primitives.schema.js';

/**
 * O contrato da tela de Desempenho. Ela responde uma pergunta — **quanto do
 * crescimento veio de aporte e quanto veio de rentabilidade** — e a forma da
 * resposta é a das três coisas que a tela mostra: a carteira contra o mercado
 * ao longo do tempo, mês a mês, e o saldo decomposto.
 *
 * Quatro decisões que o contrato torna impossíveis de desfazer sem quebrar o
 * typecheck dos dois lados:
 *
 * - **Retorno ausente é nulo, nunca zero.** Janela maior que o histórico, mês
 *   anterior ao primeiro fechamento e classe sem capital no período chegam
 *   como `null`, e a tela mostra traço. Zero significa que o número é zero.
 * - **O método viaja com o número.** A carteira tem cota e a classe não; as duas
 *   são respostas diferentes para "quanto rendeu", e a tela precisa poder dizer
 *   qual é qual.
 * - **As listas de valor vão alinhadas às colunas.** `columns[i]` descreve
 *   `values[i]`: a tela não reconstrói a janela de cada coluna, ela a recebe.
 * - **Diferença é em pontos percentuais.** "Ganhou 1,4 pp do CDI" é frase; um
 *   quociente entre dois percentuais responde outra pergunta.
 */
export const PERFORMANCE_WINDOW_KEYS = [
  'month',
  '3m',
  '6m',
  'ytd',
  '12m',
  '24m',
  'inception',
] as const;

export const performanceWindowKeySchema = z.enum(PERFORMANCE_WINDOW_KEYS);

/** As janelas das tabelas por carteira e por classe: as quatro que a prancha cita. */
export const PERFORMANCE_BREAKDOWN_KEYS = ['month', 'ytd', '12m', 'inception'] as const;

export const performanceBreakdownKeySchema = z.enum(PERFORMANCE_BREAKDOWN_KEYS);

const returnOrNull = decimalString.nullable();

export const performanceBenchmarkSchema = z.object({
  /** O texto canônico (`CDI`, `IPCA+6`, `110%CDI`): é a identidade e o que a URL carrega. */
  id: z.string(),
  name: z.string(),
  kind: z.enum(['index', 'index_plus_rate', 'percent_of_index']),
});

export const performanceScopeSchema = z.object({
  /** Nulo em Todas as carteiras: o escopo é a soma delas. */
  portfolio_id: uuid.nullable(),
  name: z.string(),
  recalc_status: z.enum(['idle', 'queued', 'running', 'failed']),
  /** O primeiro fechamento do escopo: é o que o período "Início" significa. */
  inception: dateOnly.nullable(),
});

/**
 * Como cada retorno foi calculado. A tela escreve o texto a partir destes
 * valores, e é por isso que eles são enumeração e não frase.
 */
export const performanceMethodSchema = z.object({
  /** `portfolio_quota`: a cota gravada da carteira. */
  portfolio: z.literal('portfolio_quota'),
  /** Classe de ativo não tem cota: o retorno é Dietz modificado. */
  class: z.literal('modified_dietz'),
  /** O índice é o produto dos fatores diários, e não uma soma de variações. */
  benchmark: z.literal('compound_daily_factors'),
  /** Nenhum número desta tela é anualizado. */
  annualized: z.literal(false),
});

export const performanceChartSchema = z.object({
  /** O fechamento de onde o período parte, em 0%. Nulo sem história. */
  base_date: dateOnly.nullable(),
  /** O primeiro ponto é a própria base. */
  dates: z.array(dateOnly),
  portfolio: z.array(decimalString),
  benchmarks: z.array(
    z.object({
      id: z.string(),
      values: z.array(decimalString),
    }),
  ),
});

export const performanceWindowColumnSchema = z.object({
  key: performanceWindowKeySchema,
  /** O fechamento de onde a janela parte. Nulo quando o histórico não chega. */
  base_date: dateOnly.nullable(),
});

export const performanceWindowRowSchema = z.object({
  kind: z.enum(['portfolio', 'benchmark', 'difference']),
  /** O benchmark da linha; nulo na carteira e na diferença. */
  benchmark: z.string().nullable(),
  name: z.string(),
  /** Um por coluna. Retorno em %, diferença em pontos percentuais. */
  values: z.array(returnOrNull),
});

export const performanceWindowsSchema = z.object({
  columns: z.array(performanceWindowColumnSchema),
  rows: z.array(performanceWindowRowSchema),
});

export const performanceBreakdownColumnSchema = z.object({
  key: performanceBreakdownKeySchema,
  base_date: dateOnly.nullable(),
});

export const performanceClassRowSchema = z.object({
  category_id: z.string(),
  name: z.string(),
  /** Token do design system, nunca hexadecimal. */
  color_token: z.string(),
  value: decimalString,
  weight_pct: decimalString,
  /** Nulo quando a classe não tem base para o período: fica em traço, não em zero. */
  returns: z.array(returnOrNull),
});

/**
 * O retorno de cada carteira, pela cota dela. Só vem em Todas as carteiras,
 * onde a soma não tem cota e a leitura por carteira é a que sobra.
 */
export const performancePortfolioRowSchema = z.object({
  portfolio_id: uuid,
  name: z.string(),
  value: decimalString,
  weight_pct: decimalString,
  /** Alinhado às colunas; nulo quando a carteira não existia na data-base. */
  returns: z.array(returnOrNull),
});

export const performanceBreakdownSchema = z.object({
  columns: z.array(performanceBreakdownColumnSchema),
  classes: z.array(performanceClassRowSchema),
  portfolios: z.array(performancePortfolioRowSchema),
});

export const performanceSchema = z.object({
  /** O último fechamento em ou antes da data pedida. Nulo antes do primeiro. */
  reference_date: dateOnly.nullable(),
  scope: performanceScopeSchema,
  method: performanceMethodSchema,
  benchmarks: z.object({
    /** Os índices simples e o benchmark da própria carteira; qualquer outro valor também vale. */
    available: z.array(performanceBenchmarkSchema),
    /** O que está na tela, na ordem das linhas e das cores. */
    selected: z.array(performanceBenchmarkSchema),
    /**
     * A referência da grade mensal e da decomposição: o benchmark declarado da
     * carteira e, sem ele, o CDI.
     */
    primary_id: z.string(),
    /**
     * Os benchmarks escolhidos cuja série não cobre o começo do período. A tela
     * diz isso em vez de desenhar uma linha curta.
     */
    gaps: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        available_from: dateOnly.nullable(),
      }),
    ),
  }),
  chart: performanceChartSchema,
  windows: performanceWindowsSchema,
  breakdown: performanceBreakdownSchema,
});

/** `CDI,IPCA+6` → lista de benchmarks; vazio ou ausente é "usar o padrão". */
const benchmarkList = z
  .string()
  .refine(
    (value) =>
      value === '' || value.split(',').every((part) => parseBenchmark(part) !== null),
    'informe benchmarks separados por vírgula, como CDI,IPCA+6',
  );

export const getPerformanceSchema = z.object({
  query: z.object({
    /** Ausente é Todas as carteiras. */
    portfolio_id: uuid.optional(),
    on_date: dateOnly.optional(),
    /** O recorte do gráfico. As tabelas não dependem dele. */
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    /** Benchmarks na tela; ausente é o padrão da carteira. */
    benchmarks: benchmarkList.optional(),
  }),
});

export type PerformanceResource = z.infer<typeof performanceSchema>;
export type PerformanceBenchmarkResource = z.infer<typeof performanceBenchmarkSchema>;
export type PerformanceWindowsResource = z.infer<typeof performanceWindowsSchema>;
export type PerformanceBreakdownResource = z.infer<typeof performanceBreakdownSchema>;
export type PerformanceMethodResource = z.infer<typeof performanceMethodSchema>;
