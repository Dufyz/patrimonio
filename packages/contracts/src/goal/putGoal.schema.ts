import { z } from 'zod';

import { dateOnly, name, positiveDecimal, uuid } from '../support/primitives.schema.js';
import { goalSchema } from './goal.schema.js';

/**
 * T-10 · O que o usuário escreve num objetivo.
 *
 * Uma carteira tem no máximo um objetivo aberto, então o objetivo não tem
 * identificador na rota: ele é `/portfolios/:portfolio_id/goal`, e o mesmo
 * `PUT` cria ou edita — como o formulário, que é um só.
 *
 * `return_assumption` é o texto que a projeção lê (`IPCA+6`, `6`); a `api`
 * recusa o que `parseReturnAssumption` não entende, em vez de guardar uma
 * premissa que a tela depois diria não ter compreendido.
 */
export const goalWritableSchema = z.object({
  name,
  target_amount: positiveDecimal,
  target_date: dateOnly,
  return_assumption: z.string().trim().min(1).max(40).nullable(),
  /** Em reais de hoje, a taxa é a real; em reais da data alvo, a nominal. */
  amount_in_today_brl: z.boolean(),
});

export const putGoalSchema = z.object({
  params: z.object({ portfolio_id: uuid }),
  body: goalWritableSchema,
});

export const deleteGoalSchema = z.object({
  params: z.object({ portfolio_id: uuid }),
});

/**
 * A prévia do modal: o objetivo como ficaria, projetado sobre o mesmo
 * fechamento, sem gravar nada. O "antes" a tela já tem.
 */
export const previewGoalSchema = z.object({
  params: z.object({ portfolio_id: uuid }),
  body: goalWritableSchema.extend({ on_date: dateOnly.optional() }),
});

export const putGoalResponseSchema = z.object({
  goal: goalWritableSchema.extend({ id: uuid }),
  message: z.string(),
});

export const previewGoalResponseSchema = z.object({ goal: goalSchema });

export type GoalWritableBody = z.infer<typeof goalWritableSchema>;
export type PutGoalBody = z.infer<typeof putGoalSchema>['body'];
export type PreviewGoalBody = z.infer<typeof previewGoalSchema>['body'];
