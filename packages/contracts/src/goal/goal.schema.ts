import { z } from 'zod';

import { dateOnly, decimalString, uuid } from '../support/primitives.schema.js';

/**
 * T-07 · Onde o usuário diz quanto quer ter e quando, e a aplicação responde se
 * o ritmo atual chega lá.
 *
 * A resposta é uma por objetivo e traz tudo pronto — progresso, onde deveria
 * estar hoje, projeção, as duas trajetórias e a tabela de aportes —, porque a
 * tela não faz conta: dois cálculos da mesma projeção divergem, e a barra que
 * diz "no caminho" ao lado de uma tabela que diz "chega em 2043" é a que
 * ninguém mais abre.
 *
 * Cinco decisões que o contrato torna impossíveis de desfazer sem quebrar o
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
 * - **Sem carteira ligada é o patrimônio todo.** `portfolios.all` é verdadeiro
 *   quando o objetivo não aponta carteira nenhuma. É a única leitura que
 *   continua certa quando uma carteira nova é criada — ligar "todas" uma a uma
 *   deixaria a nova de fora sem ninguém ter decidido isso.
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

export const goalPortfolioSchema = z.object({
  id: uuid,
  name: z.string(),
  /** O último fechamento até a data. Nulo quando a carteira ainda não fechou. */
  value: decimalString.nullable(),
});

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
});

export const goalContributionRowSchema = z.object({
  monthly_contribution: decimalString,
  /** `current` é o ritmo de hoje; `required` fecha a meta; `option` é redondo. */
  kind: z.enum(['current', 'required', 'option']),
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
  created_on: dateOnly,
  portfolios: z.object({
    /** Verdadeiro quando o objetivo é medido pelo patrimônio todo. */
    all: z.boolean(),
    items: z.array(goalPortfolioSchema),
  }),
  /** O valor das carteiras do objetivo no último fechamento de cada uma. */
  current_value: decimalString,
  /** O fechamento mais recente entre elas. Nulo quando nenhuma fechou. */
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
    /** Nulo é o consolidado: "todas as carteiras" é a ausência de escopo. */
    portfolio_id: uuid.nullable(),
    name: z.string(),
  }),
  /** Os objetivos abertos, do prazo mais próximo ao mais distante. */
  goals: z.array(goalSchema),
});

const RATE_OVERRIDE = /^\d{1,3}(\.\d{1,4})?$/;

/**
 * `id:6,id:5.5` → taxa alterada por objetivo. O formato é o da lista que a URL
 * da tela já guarda, e cada parte é validada aqui: um `NaN` chegando à conta é
 * uma projeção sem aviso.
 */
const rateOverrides = z.string().refine(
  (value) =>
    value === '' ||
    value.split(',').every((part) => {
      const [id, rate, ...rest] = part.split(':');

      return (
        rest.length === 0 &&
        uuid.safeParse(id).success &&
        rate !== undefined &&
        RATE_OVERRIDE.test(rate) &&
        Number(rate) <= 100
      );
    }),
  'informe pares id:taxa separados por vírgula, com a taxa entre 0 e 100',
);

export const getGoalsSchema = z.object({
  query: z.object({
    /** Ausente é o consolidado. A carteira é filtro, não rota. */
    portfolio_id: uuid.optional(),
    on_date: dateOnly.optional(),
    /** A taxa ao ano de cada objetivo, no lugar da premissa guardada. */
    rates: rateOverrides.optional(),
  }),
});

export type GoalResource = z.infer<typeof goalSchema>;
export type GoalsResource = z.infer<typeof goalsSchema>;
export type GoalRateResource = z.infer<typeof goalRateSchema>;
export type GoalProjectionResource = z.infer<typeof goalProjectionSchema>;
export type GoalContributionRowResource = z.infer<typeof goalContributionRowSchema>;
