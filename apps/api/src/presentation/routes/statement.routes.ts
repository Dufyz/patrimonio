import { getStatementSchema } from '@patrimonio/contracts';
import { Router } from 'express';

import type { StatementDeps } from '../controllers/statement.controller.js';
import { createStatementController } from '../controllers/statement.controller.js';
import { validate } from '../middleware/validate.js';

/**
 * T-04 · O extrato.
 *
 * Em arquivo próprio, e não dentro de `transaction.routes.ts`, porque o que a
 * tela de Movimentações lê não é o lançamento cru: é o recorte agregado, com o
 * efeito de cada linha e os subtotais. `GET /transactions` continua sendo a
 * listagem do livro; esta é a leitura de tela.
 */
export const statementRoutes = (deps: StatementDeps): Router => {
  const router = Router();
  const controller = createStatementController(deps);

  router.get('/statement', validate(getStatementSchema), controller.list);

  return router;
};
