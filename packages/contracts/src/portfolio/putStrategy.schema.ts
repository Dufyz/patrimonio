import { z } from 'zod';

import { uuid } from '../support/primitives.schema.js';
import { strategyTargetResourceSchema } from './portfolio.schema.js';

/**
 * O alvo por categoria. A soma precisa fechar 100 — ou a lista vir vazia, que é
 * "sem estratégia definida". O banco recusa o que escapar daqui: a verificação
 * do serviço protege o caminho que passa por ele, a do banco protege também a
 * importação e o script rodado às onze da noite.
 */
export const putStrategySchema = z.object({
  params: z.object({ portfolio_id: uuid }),
  body: z.object({ targets: z.array(strategyTargetResourceSchema) }),
});

export const getStrategySchema = z.object({
  params: z.object({ portfolio_id: uuid }),
});

export type PutStrategyBody = z.infer<typeof putStrategySchema>['body'];
