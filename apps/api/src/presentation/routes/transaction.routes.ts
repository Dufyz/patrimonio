import {
  confirmPayoutSchema,
  createCashMovementSchema,
  createPayoutSchema,
  dismissPayoutSchema,
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
  router.post('/transactions/cash', validate(createCashMovementSchema), controller.cash);
  router.post('/transactions/payouts', validate(createPayoutSchema), controller.payout);
  router.post(
    '/transactions/:transaction_id/confirm',
    validate(confirmPayoutSchema),
    controller.confirm,
  );
  router.post(
    '/transactions/:transaction_id/dismiss',
    validate(dismissPayoutSchema),
    controller.dismiss,
  );
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
