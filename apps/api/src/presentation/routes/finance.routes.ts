import * as c from '@patrimonio/contracts';
import { Router } from 'express';

import { createFinanceController } from '../controllers/finance.controller.js';
import type { FinanceRouteDeps } from '../controllers/finance.controller.js';
import { validate } from '../middleware/validate.js';

/**
 * Finanças, tudo sob `/finance`. Rotas fixas (`/entries/export`,
 * `/categories/breakdown`) vêm antes das com `:id`, senão o Express as trataria
 * como identificador.
 */
export const financeRoutes = (deps: FinanceRouteDeps): Router => {
  const router = Router();
  const f = createFinanceController(deps);

  router.get('/finance/overview', validate(c.finOverviewSchema), f.overview);
  router.get('/finance/search', validate(c.finSearchSchema), f.search);
  router.post('/finance/jobs/sync', validate(c.syncFinanceSchema), f.sync);

  router.get(
    '/finance/categories',
    validate(c.listFinCategoriesSchema),
    f.listCategories,
  );
  router.get(
    '/finance/categories/breakdown',
    validate(c.categoryBreakdownSchema),
    f.categoryBreakdown,
  );
  router.post(
    '/finance/categories',
    validate(c.createFinCategorySchema),
    f.createCategory,
  );
  router.put(
    '/finance/categories/:id',
    validate(c.updateFinCategorySchema),
    f.updateCategory,
  );
  router.post(
    '/finance/categories/:id/archive',
    validate(c.archiveFinCategorySchema),
    f.archiveCategory,
  );
  router.delete(
    '/finance/categories/:id',
    validate(c.deleteFinCategorySchema),
    f.deleteCategory,
  );

  router.get('/finance/accounts', validate(c.listAccountsSchema), f.listAccounts);
  router.get('/finance/accounts/:id/statement', validate(c.statementSchema), f.statement);
  router.post('/finance/accounts', validate(c.createAccountSchema), f.createAccount);
  router.put('/finance/accounts/:id', validate(c.updateAccountSchema), f.updateAccount);
  router.post(
    '/finance/accounts/:id/archive',
    validate(c.archiveAccountSchema),
    f.archiveAccount,
  );
  router.delete(
    '/finance/accounts/:id',
    validate(c.deleteAccountSchema),
    f.deleteAccount,
  );

  router.post('/finance/transfers', validate(c.createTransferSchema), f.createTransfer);
  router.put(
    '/finance/transfers/:id',
    validate(c.updateTransferSchema),
    f.updateTransfer,
  );
  router.delete(
    '/finance/transfers/:id',
    validate(c.deleteTransferSchema),
    f.deleteTransfer,
  );

  router.get('/finance/cards', validate(c.listCardsSchema), f.listCards);
  router.get('/finance/cards/:id/invoices/:month', validate(c.invoiceSchema), f.invoice);
  router.post(
    '/finance/cards/:id/invoices/:month/payments',
    validate(c.payInvoiceSchema),
    f.payInvoice,
  );
  router.post(
    '/finance/cards/:id/items',
    validate(c.createCardItemSchema),
    f.createCardItem,
  );
  router.post('/finance/cards', validate(c.createCardSchema), f.createCard);
  router.put('/finance/cards/:id', validate(c.updateCardSchema), f.updateCard);
  router.post('/finance/cards/:id/archive', validate(c.archiveCardSchema), f.archiveCard);
  router.delete('/finance/cards/:id', validate(c.deleteCardSchema), f.deleteCard);
  router.delete(
    '/finance/payments/:payment_id',
    validate(c.deleteInvoicePaymentSchema),
    f.deleteInvoicePayment,
  );
  router.delete(
    '/finance/card-items/:item_id',
    validate(c.deleteCardItemSchema),
    f.deleteCardItem,
  );

  router.get('/finance/recurrings', validate(c.listRecurringsSchema), f.listRecurrings);
  router.post(
    '/finance/recurrings',
    validate(c.createRecurringSchema),
    f.createRecurring,
  );
  router.put(
    '/finance/recurrings/:id',
    validate(c.updateRecurringSchema),
    f.updateRecurring,
  );
  router.post(
    '/finance/recurrings/:id/active',
    validate(c.recurringActiveSchema),
    f.setRecurringActive,
  );
  router.post(
    '/finance/recurrings/:id/skip',
    validate(c.skipRecurringSchema),
    f.skipRecurring,
  );
  router.delete(
    '/finance/recurrings/:id',
    validate(c.deleteRecurringSchema),
    f.deleteRecurring,
  );

  router.get('/finance/entries', validate(c.listEntriesSchema), f.listEntries);
  router.get('/finance/entries/export', validate(c.exportEntriesSchema), f.exportEntries);
  router.get('/finance/entries/:id', validate(c.getEntrySchema), f.getEntry);
  router.post('/finance/entries', validate(c.createEntrySchema), f.createEntry);
  router.put('/finance/entries/:id', validate(c.updateEntrySchema), f.updateEntry);
  router.post(
    '/finance/entries/:id/confirm',
    validate(c.confirmEntrySchema),
    f.confirmEntry,
  );
  router.delete('/finance/entries/:id', validate(c.deleteEntrySchema), f.deleteEntry);

  return router;
};
