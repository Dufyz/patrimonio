import {
  createTransactionSchema,
  getTransactionSchema,
  listTransactionsSchema,
  previewTransactionSchema,
} from '@patrimonio/contracts';
import { Router } from 'express';

import type { TransactionDeps } from '../controllers/transaction.controller.js';
import { createTransactionController } from '../controllers/transaction.controller.js';
import { validate } from '../middleware/validate.js';

export const transactionRoutes = (deps: TransactionDeps): Router => {
  const router = Router();
  const controller = createTransactionController(deps);

  router.get('/transactions', validate(listTransactionsSchema), controller.list);
  router.post('/transactions', validate(createTransactionSchema), controller.create);
  // Antes de `/transactions/:id`, senão "preview" vira um id.
  router.post(
    '/transactions/preview',
    validate(previewTransactionSchema),
    controller.preview,
  );
  router.get(
    '/transactions/:transaction_id',
    validate(getTransactionSchema),
    controller.detail,
  );

  return router;
};
