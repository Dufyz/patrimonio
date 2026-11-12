import { z } from 'zod';

import {
  dateOnly,
  decimalString,
  positiveDecimal,
  uuid,
} from '../support/primitives.schema.js';

/**
 * T-07 · Onde o usuário diz quanto quer ter e quando, e a aplicação responde se
 * o ritmo atual chega lá.
 *
 * A resposta é a do objetivo da carteira e traz tudo pronto — progresso, onde deveria
 * estar hoje, projeção, as duas trajetórias e a tabela de aportes —, porque a
 * tela não faz conta: dois cálculos da mesma projeção divergem, e a barra que
 * diz "no caminho" ao lado de uma tabela que diz "chega em 2043" é a que
 * ninguém mais abre.
 *
 * Quatro decisões que o contrato torna impossíveis de desfazer sem quebrar o
 * typecheck dos dois lados:
 *
 * - **A taxa viaja com a projeção.** `rate` diz qual taxa foi usada, se é real
 *   ou nominal, de onde ela veio e se alguém a trocou. Projeção sem a taxa que a
 *   produziu é adivinhação com aparência de certeza.
 * - **Projeção bloqueada é explicada, nunca zero.** Sem premissa entendida, sem
 *   inflação para uma meta nominal ou sem história, `projection` é nulo e
 *   `blocked` diz por quê. A tela escreve o motivo, e não um "chega em —" que
 *   parece um resultado.
 * - **Chegar é uma data ou nada.** `arrival_date` nulo é "não chega em cem
 *   anos"; zero meses é "já chegou". Os dois não se confundem.
 * - **Valor em reais de hoje é a moeda da tela.** Com a meta em reais de hoje a
 *   taxa é a real, a meta é uma linha reta e o aporte é em reais de hoje. A
 *   tela escreve isso, e `rate.basis` é o que o permite.
 */
export const GOAL_STATUSES = [
  'on_track',
  'behind',
  'overdue',
  'reached',
  'no_projection',
] as const;

export const goalStatusSchema = z.enum(GOAL_STATUSES);

/** Por que a projeção não existe. */
export const GOAL_BLOCKS = [
  'no_assumption',
  'unrecognized_assumption',
  'no_inflation',
  'no_history',
] as const;

export const goalBlockSchema = z.enum(GOAL_BLOCKS);

export const goalRateSchema = z.object({
  /** O texto guardado no objetivo, como o usuário o escreveu. */
  assumption: z.string().nullable(),
  kind: z.enum(['ipca_plus', 'fixed']),
  /** A taxa ao ano, em %, que entrou na conta. */
  used_pct: decimalString,
  /**
   * `real` quando a meta é em reais de hoje: patrimônio, meta e aporte na mesma
   * moeda. `nominal` quando a meta é em reais da data alvo.
   */
  basis: z.enum(['real', 'nominal']),
  /** A taxa da premissa, antes de qualquer alteração. Nulo sem premissa. */
  declared_pct: decimalString.nullable(),
  /** Verdadeiro quando a taxa veio do pedido, e não da premissa guardada. */
  overridden: z.boolean(),
  /** O IPCA dos últimos doze meses, usado só em meta nominal com `IPCA+x`. */
  inflation_pct: decimalString.nullable(),
  /** A premissa guardada como taxa nominal ao ano. Nulo sem IPCA para convertê-la. */
  premise_pct: decimalString.nullable(),
  /** A taxa em uso como nominal ao ano. Nulo sem IPCA para convertê-la. */
  nominal_pct: decimalString.nullable(),
});

export const goalPaceSchema = z.object({
  /** A média de aporte por mês no período medido. */
  monthly_contribution: decimalString,
  /**
   * Quantos meses entraram na média: até doze, e menos que isso quando a
   * história é mais curta. Dividir por doze um ano que só tem quatro meses
   * subestimaria o ritmo e atrasaria a data de chegada.
   */
  months_measured: z.number().int().nonnegative(),
});

export const goalProjectionSchema = z.object({
  /** Onde o ritmo atual chega na data alvo. */
  projected_amount: decimalString,
  /** O aporte mensal que fecha a meta na data. Zero quando já está feito. */
  required_monthly: decimalString,
  /** Onde o ritmo atual chega. Nulo quando não chega em cem anos. */
  arrival_date: dateOnly.nullable(),
  months_to_arrival: z.number().int().nonnegative().nullable(),
  /** Quanto falta na data alvo. Negativo quando sobra. */
  gap_brl: decimalString,
  on_track: z.boolean(),
});

/** Um ponto por mês, de hoje à data alvo. A meta é a linha reta `target_amount`. */
export const goalChartSchema = z.object({
  dates: z.array(dateOnly),
  /** No ritmo atual. */
  pace: z.array(decimalString),
  /** A trajetória que fecha a meta na data. */
  required: z.array(decimalString),
  /** Com o aporte simulado (`monthly`). Nulo sem simulação. */
  plan: z.array(decimalString).nullable(),
});

export const goalContributionRowSchema = z.object({
  monthly_contribution: decimalString,
  /** `current` é o ritmo de hoje; `required` fecha a meta; `option` é redondo; `custom` é o simulado. */
  kind: z.enum(['current', 'required', 'option', 'custom']),
  /** Verdadeiro para o aporte pedido em `monthly`. */
  selected: z.boolean(),
  arrival_date: dateOnly.nullable(),
  months_to_arrival: z.number().int().nonnegative().nullable(),
  /** Verdadeiro quando esse aporte chega até a data alvo. */
  reaches_target_date: z.boolean(),
});

export const goalSchema = z.object({
  id: uuid,
  name: z.string(),
  /** Na moeda de `amount_in_today_brl`: reais de hoje, ou reais da data alvo. */
  target_amount: decimalString,
  target_date: dateOnly,
  amount_in_today_brl: z.boolean(),
  /** O texto da premissa como foi guardado; nulo quando não há. O formulário o relê daqui. */
  return_assumption: z.string().nullable(),
  created_on: dateOnly,
  /** O valor da carteira no último fechamento até a data. */
  current_value: decimalString,
  /** A data desse fechamento. Nulo quando a carteira ainda não fechou. */
  as_of: dateOnly.nullable(),
  /** Nunca passa de 100: o excedente sai em `surplus_brl`. */
  progress_pct: decimalString,
  remaining_brl: decimalString,
  surplus_brl: decimalString.nullable(),
  /** Onde o objetivo deveria estar hoje para chegar no prazo. Nulo sem tempo medido. */
  expected_pct: decimalString.nullable(),
  status: goalStatusSchema,
  months_remaining: z.number().int().nonnegative(),
  blocked: goalBlockSchema.nullable(),
  rate: goalRateSchema.nullable(),
  pace: goalPaceSchema,
  projection: goalProjectionSchema.nullable(),
  chart: goalChartSchema.nullable(),
  contributions: z.array(goalContributionRowSchema),
});

export const goalsSchema = z.object({
  /** A data de onde a projeção parte: "hoje", ou a data pedida. */
  reference_date: dateOnly,
  scope: z.object({
    portfolio_id: uuid,
    name: z.string(),
  }),
  /** O objetivo aberto da carteira: ela tem no máximo um. Nulo quando ainda não há. */
  goal: goalSchema.nullable(),
});

const RATE_OVERRIDE = /^\d{1,3}(\.\d{1,4})?$/;

/**
 * A taxa ao ano, em %, no lugar da premissa guardada: `6` ou `5.5`. É validada
 * aqui: um `NaN` chegando à conta é uma projeção sem aviso.
 */
const rateOverride = z
  .string()
  .refine(
    (value) => RATE_OVERRIDE.test(value) && Number(value) <= 100,
    'informe a taxa entre 0 e 100',
  );

export const getGoalsSchema = z.object({
  query: z.object({
    portfolio_id: uuid,
    on_date: dateOnly.optional(),
    /** A taxa ao ano do objetivo, no lugar da premissa guardada. */
    rate: rateOverride.optional(),
    /**
     * A rentabilidade nominal ao ano no lugar da premissa, como a "esperada" da
     * Projeção. Vale sobre `rate`.
     */
    nominal_rate: rateOverride.optional(),
    /** Um aporte mensal a simular. */
    monthly: positiveDecimal.optional(),
  }),
});

export type GoalResource = z.infer<typeof goalSchema>;
export type GoalsResource = z.infer<typeof goalsSchema>;
export type GoalRateResource = z.infer<typeof goalRateSchema>;
export type GoalProjectionResource = z.infer<typeof goalProjectionSchema>;
export type GoalContributionRowResource = z.infer<typeof goalContributionRowSchema>;
