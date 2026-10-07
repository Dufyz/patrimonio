import { z } from 'zod';

import { name, uuid } from '../support/primitives.schema.js';

/**
 * Excluir exige dizer o que fazer com o conteúdo e digitar o nome da carteira:
 * é o atrito proporcional ao estrago, que aqui é apagar histórico de anos.
 */
export const deletePortfolioSchema = z.object({
  params: z.object({ portfolio_id: uuid }),
  body: z
    .object({
      confirm_name: name,
      /**
       * `move` leva posições e lançamentos para outra carteira; `delete` apaga
       * os lançamentos junto, e aí o patrimônio histórico muda.
       */
      transactions: z.enum(['move', 'delete']),
      destination_portfolio_id: uuid.optional(),
    })
    .refine(
      (body) => body.transactions !== 'move' || body.destination_portfolio_id !== undefined,
      {
        message: 'mover o conteúdo exige a carteira de destino',
        path: ['destination_portfolio_id'],
      },
    ),
});

export type DeletePortfolioBody = z.infer<typeof deletePortfolioSchema>['body'];
