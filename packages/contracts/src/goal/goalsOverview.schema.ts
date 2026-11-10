import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';
import { goalBlockSchema, goalStatusSchema } from './goal.schema.js';

/**
 * T-07 · Os objetivos de **todas** as carteiras: a pergunta é "quanto preciso
 * aportar por mês, no total e em cada carteira, para bater todas as metas, e
 * quando isso acontece".
 *
 * É um panorama. Não existe objetivo global: cada carteira tem o seu, e criar,
 * editar ou excluir continua sendo dentro dela. A resposta traz tudo pronto,
 * inclusive o plano de aportes do orçamento pedido, porque a tela não faz
 * conta — duas contas da mesma data de chegada divergem.
 *
 * Três decisões que o contrato torna difíceis de desfazer:
 *
 * - **Só se soma o que é comparável.** Tudo entra em reais de hoje: a meta em
 *   reais da data alvo é convertida pelo IPCA dos últimos doze meses
 *   (`nominal_target_amount` guarda a original, `totals.inflation_pct` a
 *   inflação usada). Meta nominal sem IPCA para converter, objetivo vencido e
 *   objetivo sem projeção ficam na tabela com o motivo (`excluded_reason`), e
 *   fora dos totais.
 * - **O plano distribui aporte futuro.** O dinheiro já investido numa carteira
 *   não migra para outra; o orçamento é dividido entre as carteiras só daqui
 *   para frente.
 * - **"Todas as metas" é uma data ou nada.** `arrival_date` nulo é "alguma meta
 *   não fecha em cem anos".
 */
export const GOALS_DISTRIBUTIONS = ['proportional', 'priority'] as const;

export const goalsDistributionSchema = z.enum(GOALS_DISTRIBUTIONS);

export const GOALS_EXCLUSIONS = ['nominal', 'overdue', 'no_projection'] as const;

export const goalsExclusionSchema = z.enum(GOALS_EXCLUSIONS);

export const goalsPlanShareSchema = z.object({
  /** A parcela mensal do orçamento que cabe a esta carteira. */
  monthly: decimalString,
  share_pct: decimalString.nullable(),
  /** Quando a meta fecha com essa parcela. Nulo quando não fecha em cem anos. */
  arrival_date: dateOnly.nullable(),
  months_to_arrival: z.number().int().nonnegative().nullable(),
  /** Verdadeiro quando fecha até o prazo do objetivo. */
  reaches_target_date: z.boolean(),
});

export const goalsOverviewGoalSchema = z.object({
  id: uuid,
  name: z.string(),
  /** Em reais de hoje: a meta nominal já convertida, quando é o caso. */
  target_amount: decimalString,
  /** A meta como foi escrita, em reais da data alvo, quando foi convertida a reais de hoje. */
  nominal_target_amount: decimalString.nullable(),
  target_date: dateOnly,
  amount_in_today_brl: z.boolean(),
  return_assumption: z.string().nullable(),
  current_value: decimalString,
  as_of: dateOnly.nullable(),
  /** Nunca passa de 100. */
  progress_pct: decimalString,
  remaining_brl: decimalString,
  /** Onde deveria estar hoje, em %. Nulo sem tempo medido. */
  expected_pct: decimalString.nullable(),
  status: goalStatusSchema,
  blocked: goalBlockSchema.nullable(),
  months_remaining: z.number().int().nonnegative(),
  /** Verdadeiro quando o objetivo entra nas somas e no plano. */
  counted: z.boolean(),
  excluded_reason: goalsExclusionSchema.nullable(),
  /** O aporte que fecha a meta na data. Nulo quando não há projeção. */
  required_monthly: decimalString.nullable(),
  required_share_pct: decimalString.nullable(),
  /** O que a carteira aporta por mês, na média dos meses medidos. */
  current_monthly: decimalString,
  current_share_pct: decimalString.nullable(),
  /** Onde o ritmo atual da carteira chega. Nulo quando não chega em cem anos. */
  current_arrival_date: dateOnly.nullable(),
  current_months_to_arrival: z.number().int().nonnegative().nullable(),
  /** A parcela do orçamento pedido. Nulo para quem não entra no plano. */
  plan: goalsPlanShareSchema.nullable(),
  /**
   * A rentabilidade nominal ao ano: a da premissa e a que entrou na conta. Nulo
   * sem premissa reconhecida nem simulação.
   */
  rate: z
    .object({
      /** Nulo quando a premissa é real (IPCA+x) e não há IPCA para convertê-la. */
      premise_pct: decimalString.nullable(),
      used_pct: decimalString.nullable(),
      /** Verdadeiro quando a simulação trocou a taxa da premissa. */
      overridden: z.boolean(),
    })
    .nullable(),
});

export const goalsOverviewRowSchema = z.object({
  portfolio_id: uuid,
  portfolio_name: z.string(),
  /** O objetivo aberto da carteira. Nulo quando ela ainda não tem um. */
  goal: goalsOverviewGoalSchema.nullable(),
});

export const goalsRequiredStepSchema = z.object({
  /** O aporte necessário total vale até esta data. */
  until: dateOnly,
  monthly: decimalString,
});

export const goalsOverviewTotalsSchema = z.object({
  /** Quantas carteiras têm objetivo. */
  goals: z.number().int().nonnegative(),
  /** Quantos entram nas somas. */
  counted: z.number().int().nonnegative(),
  target_amount: decimalString,
  current_value: decimalString,
  remaining_brl: decimalString,
  progress_pct: decimalString,
  expected_pct: decimalString.nullable(),
  last_target_date: dateOnly.nullable(),
  required_monthly: decimalString,
  current_monthly: decimalString,
  /** Quanto falta aportar por mês; negativo quando o de hoje já passa do necessário. */
  gap_monthly: decimalString,
  required_schedule: z.array(goalsRequiredStepSchema),
  /** Quando a última meta fecha no ritmo atual de cada carteira. Nulo se alguma não fecha. */
  pace_arrival_date: dateOnly.nullable(),
  /** Meses entre o último prazo e essa data: negativo é antes do prazo. */
  pace_months_vs_deadline: z.number().int().nullable(),
  /** O IPCA dos últimos doze meses que converteu as metas nominais. Nulo sem IPCA. */
  inflation_pct: decimalString.nullable(),
});

export const goalsScenarioSchema = z.object({
  monthly: decimalString,
  /** `current` é o ritmo de hoje; `required` fecha todas no prazo; `custom` é o pedido. */
  kind: z.enum(['current', 'required', 'option', 'custom']),
  /** Quando a última meta fecha. Nulo quando alguma não fecha em cem anos. */
  arrival_date: dateOnly.nullable(),
  /** Meses entre o último prazo e a chegada: negativo é antes do prazo. */
  months_vs_deadline: z.number().int().nullable(),
  selected: z.boolean(),
});

export const goalsOverviewChartSchema = z.object({
  /** Um ponto por mês, de hoje até onde a história precisa. */
  dates: z.array(dateOnly),
  /** O quanto da meta somada está feito no ritmo atual de cada carteira. */
  pace: z.array(decimalString),
  /** … aportando o necessário em cada uma. */
  required: z.array(decimalString),
  /** … com o orçamento pedido. */
  plan: z.array(decimalString),
  /** A meta somada: a linha reta. */
  target_amount: decimalString,
});

export const goalsOverviewSchema = z.object({
  reference_date: dateOnly,
  portfolios: z.array(goalsOverviewRowSchema),
  totals: goalsOverviewTotalsSchema,
  /** O orçamento do plano e como ele foi dividido. */
  plan: z.object({
    budget: decimalString,
    distribution: goalsDistributionSchema,
    cascade: z.boolean(),
    arrival_date: dateOnly.nullable(),
    months_vs_deadline: z.number().int().nullable(),
  }),
  scenarios: z.array(goalsScenarioSchema),
  chart: goalsOverviewChartSchema.nullable(),
});

const boolean = z.enum(['true', 'false']).transform((value) => value === 'true');

const RATE = /^\d{1,3}(\.\d{1,4})?$/;

/** `id:6.5,id:10`: a taxa ao ano simulada de cada carteira, no lugar da premissa. */
const ratesQuery = z
  .string()
  .transform((value) =>
    value === ''
      ? []
      : value.split(',').map((pair) => {
          const [id = '', rate = ''] = pair.split(':');
          return [id, rate] as const;
        }),
  )
  .pipe(
    z.array(
      z.tuple([
        uuid,
        z
          .string()
          .refine((rate) => RATE.test(rate) && Number(rate) <= 100, 'taxa de 0 a 100'),
      ]),
    ),
  )
  .transform((pairs) => Object.fromEntries(pairs) as Record<string, string>);

export const getGoalsOverviewSchema = z.object({
  query: z.object({
    on_date: dateOnly.optional(),
    /** O aporte mensal total a distribuir. Sem ele, vale o necessário. */
    budget: positiveDecimal.optional(),
    distribution: goalsDistributionSchema.optional(),
    /** Reaproveitar o aporte de metas fechadas. Padrão: sim. */
    cascade: boolean.optional(),
    /** Na distribuição por prioridade: os ids das carteiras, separados por vírgula, na ordem. */
    priority: z
      .string()
      .transform((value) => (value === '' ? [] : value.split(',')))
      .pipe(z.array(uuid))
      .optional(),
    /** A rentabilidade nominal ao ano simulada por carteira (`id:taxa`, separadas por vírgula). */
    rates: ratesQuery.optional(),
  }),
});

export type GoalsOverviewResource = z.infer<typeof goalsOverviewSchema>;
export type GoalsOverviewRowResource = z.infer<typeof goalsOverviewRowSchema>;
export type GoalsOverviewGoalResource = z.infer<typeof goalsOverviewGoalSchema>;
export type GoalsScenarioResource = z.infer<typeof goalsScenarioSchema>;
export type GoalsDistribution = z.infer<typeof goalsDistributionSchema>;
