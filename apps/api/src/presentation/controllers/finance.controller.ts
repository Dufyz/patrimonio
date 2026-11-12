import type { FinanceUseCases, FinanceOutcome } from '@patrimonio/application';
import type { AppError } from '@patrimonio/application';
import type { Either } from '@patrimonio/shared';
import type { Request, RequestHandler, Response } from 'express';

import {
  idempotencyKey,
  ifMatchVersion,
  sendFailure,
  validatedQuery,
} from '../middleware/respond.js';

export type FinanceRouteDeps = {
  readonly usecases: { readonly finance: FinanceUseCases };
};

type Query = Record<string, unknown>;

/** Cabeçalhos e `?preview=true` comuns a toda escrita. */
const meta = (request: Request) => ({
  preview: (validatedQuery<Query>(request)?.['preview'] as boolean | undefined) === true,
  idempotencyKey: idempotencyKey(request),
  ifMatch: ifMatchVersion(request),
});

const send = <T>(
  request: Request,
  response: Response,
  result: Either<AppError, T>,
  onSuccess: (value: T) => void,
): void => {
  if (result.isFailure()) {
    sendFailure(request, response, result.value);
    return;
  }
  onSuccess(result.value);
};

const sendOutcome = (
  request: Request,
  response: Response,
  result: Either<AppError, FinanceOutcome>,
): void =>
  send(request, response, result, (outcome) => {
    if (outcome.replayed) response.setHeader('Idempotent-Replayed', 'true');
    response.status(outcome.status).json(outcome.body);
  });

const notFound = (request: Request, response: Response, what: string): void => {
  response
    .status(404)
    .json({ message: `${what} não encontrado`, request_id: request.requestId });
};

const param = (request: Request, key: string): string => String(request.params[key]);
const q = (request: Request): Query => validatedQuery<Query>(request) ?? {};
const body = <T>(request: Request): T => request.body as T;

const csvEscape = (value: string): string =>
  /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const decimalComma = (value: string): string => value.replace('.', ',');

export type FinanceHandler =
  | 'snapshot'
  | 'overview'
  | 'search'
  | 'listCategories'
  | 'categoryBreakdown'
  | 'createCategory'
  | 'updateCategory'
  | 'archiveCategory'
  | 'deleteCategory'
  | 'listAccounts'
  | 'statement'
  | 'createAccount'
  | 'updateAccount'
  | 'archiveAccount'
  | 'deleteAccount'
  | 'createTransfer'
  | 'updateTransfer'
  | 'deleteTransfer'
  | 'listCards'
  | 'createCard'
  | 'updateCard'
  | 'archiveCard'
  | 'deleteCard'
  | 'invoice'
  | 'payInvoice'
  | 'deleteInvoicePayment'
  | 'createCardItem'
  | 'deleteCardItem'
  | 'moveEntryInvoice'
  | 'moveCardItemInvoice'
  | 'listRecurrings'
  | 'createRecurring'
  | 'updateRecurring'
  | 'setRecurringActive'
  | 'skipRecurring'
  | 'deleteRecurring'
  | 'listEntries'
  | 'exportEntries'
  | 'getEntry'
  | 'createEntry'
  | 'updateEntry'
  | 'confirmEntry'
  | 'deleteEntry'
  | 'sync';
export type FinanceController = { readonly [K in FinanceHandler]: RequestHandler };

export const createFinanceController = (deps: FinanceRouteDeps): FinanceController => {
  const uc = deps.usecases.finance;
  const write =
    (
      run: (request: Request) => Promise<Either<AppError, FinanceOutcome>>,
    ): RequestHandler =>
    async (request, response) =>
      sendOutcome(request, response, await run(request));

  const read =
    <T>(
      run: (request: Request) => Promise<Either<AppError, T>>,
      shape: (value: T) => unknown = (value) => value,
    ): RequestHandler =>
    async (request, response) =>
      send(request, response, await run(request), (value) => {
        response.status(200).json(shape(value));
      });

  return {
    snapshot: read(() => uc.getSnapshot()),
    overview: read((r) => uc.getOverview(q(r)['month'] as string | undefined)),
    search: read(
      (r) => uc.search(q(r)['q'] as string, q(r)['limit'] as number | undefined),
      (groups) => ({ groups }),
    ),

    // Categorias
    listCategories: read(
      (r) => uc.listFinanceCategories(q(r)['include_archived'] === true),
      (categories) => ({ categories }),
    ),
    categoryBreakdown: read((r) =>
      uc.getCategoryBreakdown(q(r)['kind'] as 'receita' | 'despesa', {
        from: q(r)['from'] as string,
        to: q(r)['to'] as string,
      }),
    ),
    createCategory: write((r) => uc.createCategory(body(r), meta(r))),
    updateCategory: write((r) => uc.updateCategory(param(r, 'id'), body(r), meta(r))),
    archiveCategory: write((r) =>
      uc.archiveCategory(
        param(r, 'id'),
        body<{ archived: boolean }>(r).archived,
        meta(r),
      ),
    ),
    deleteCategory: write((r) => uc.deleteCategory(param(r, 'id'), meta(r))),

    // Contas
    listAccounts: read((r) =>
      uc.getAccounts(
        { month: q(r)['month'] as string | undefined },
        q(r)['include_archived'] === true,
      ),
    ),
    statement: (async (request, response) => {
      const query = q(request);
      const result = await uc.getStatement(param(request, 'id'), {
        month: query['month'] as string | undefined,
        from: query['from'] as string | undefined,
        to: query['to'] as string | undefined,
      });
      send(request, response, result, (value) =>
        value === null
          ? notFound(request, response, 'Conta')
          : void response.status(200).json(value),
      );
    }) as RequestHandler,
    createAccount: write((r) => uc.createAccount(body(r), meta(r))),
    updateAccount: write((r) => uc.updateAccount(param(r, 'id'), body(r), meta(r))),
    archiveAccount: write((r) =>
      uc.archiveAccount(param(r, 'id'), body<{ archived: boolean }>(r).archived, meta(r)),
    ),
    deleteAccount: write((r) => uc.deleteAccount(param(r, 'id'), meta(r))),

    // Transferências
    createTransfer: write((r) => uc.createTransfer(body(r), meta(r))),
    updateTransfer: write((r) => uc.updateTransfer(param(r, 'id'), body(r), meta(r))),
    deleteTransfer: write((r) => uc.deleteTransfer(param(r, 'id'), meta(r))),

    // Cartões e faturas
    listCards: read(() => uc.getCards()),
    createCard: write((r) => uc.createCard(body(r), meta(r))),
    updateCard: write((r) => uc.updateCard(param(r, 'id'), body(r), meta(r))),
    archiveCard: write((r) =>
      uc.archiveCard(param(r, 'id'), body<{ archived: boolean }>(r).archived, meta(r)),
    ),
    deleteCard: write((r) => uc.deleteCard(param(r, 'id'), meta(r))),
    invoice: (async (request, response) => {
      const result = await uc.getInvoice(param(request, 'id'), param(request, 'month'));
      send(request, response, result, (value) =>
        value === null
          ? notFound(request, response, 'Cartão')
          : void response.status(200).json(value),
      );
    }) as RequestHandler,
    payInvoice: write((r) =>
      uc.payInvoice(param(r, 'id'), param(r, 'month'), body(r), meta(r)),
    ),
    deleteInvoicePayment: write((r) =>
      uc.deleteInvoicePayment(param(r, 'payment_id'), meta(r)),
    ),
    createCardItem: write((r) => uc.addCardItem(param(r, 'id'), body(r), meta(r))),
    deleteCardItem: write((r) => uc.deleteCardItem(param(r, 'item_id'), meta(r))),
    moveEntryInvoice: write((r) =>
      uc.moveToInvoice('entry', param(r, 'id'), body<{ invoice_month: string }>(r).invoice_month, meta(r)),
    ),
    moveCardItemInvoice: write((r) =>
      uc.moveToInvoice('item', param(r, 'item_id'), body<{ invoice_month: string }>(r).invoice_month, meta(r)),
    ),

    // Recorrentes
    listRecurrings: read(
      () => uc.listRecurrings(),
      (recurrings) => ({ recurrings }),
    ),
    createRecurring: write((r) => uc.createRecurring(body(r), meta(r))),
    updateRecurring: write((r) => uc.updateRecurring(param(r, 'id'), body(r), meta(r))),
    setRecurringActive: write((r) =>
      uc.setRecurringActive(param(r, 'id'), body<{ active: boolean }>(r).active, meta(r)),
    ),
    skipRecurring: write((r) =>
      uc.skipRecurringMonth(param(r, 'id'), body<{ month: string }>(r).month, meta(r)),
    ),
    deleteRecurring: write((r) => uc.deleteRecurring(param(r, 'id'), meta(r))),

    // Lançamentos
    listEntries: read((r) => {
      const {
        month,
        from,
        to,
        kind,
        category_id,
        source_id,
        status,
        q: text,
        cursor,
        limit,
        group,
      } = q(r) as Query;
      return uc.listEntries(
        { month, from, to, kind, category_id, source_id, status, q: text } as never,
        cursor as string | undefined,
        limit as number,
        group as never,
      );
    }),
    exportEntries: (async (request, response) => {
      const result = await uc.exportEntries(q(request) as never);
      send(request, response, result, (rows) => {
        const lines = [
          ['Data', 'Tipo', 'Descrição', 'Categoria', 'Origem', 'Situação', 'Valor'].join(
            ';',
          ),
          ...rows.map(({ entry, category, sources }) =>
            [
              entry.date,
              entry.kind === 'receita' ? 'Receita' : 'Despesa',
              entry.description,
              category,
              sources.join(' + '),
              entry.status === 'lancada' ? 'Lançada' : 'Prevista',
              decimalComma(entry.kind === 'despesa' ? `-${entry.amount}` : entry.amount),
            ]
              .map(csvEscape)
              .join(';'),
          ),
        ];
        response
          .status(200)
          .setHeader('Content-Type', 'text/csv; charset=utf-8')
          .setHeader('Content-Disposition', 'attachment; filename="lancamentos.csv"')
          .send(`\uFEFF${lines.join('\r\n')}\r\n`);
      });
    }) as RequestHandler,
    getEntry: (async (request, response) => {
      const result = await uc.getEntry(param(request, 'id'));
      send(request, response, result, (value) =>
        value === null
          ? notFound(request, response, 'Lançamento')
          : void response.status(200).json({ entry: value }),
      );
    }) as RequestHandler,
    createEntry: write((r) => uc.createEntry(body(r), meta(r))),
    updateEntry: write((r) => {
      const { scope, ...draft } = body<{ scope?: never } & Record<string, never>>(r);
      return uc.updateEntry(param(r, 'id'), draft as never, scope, meta(r));
    }),
    confirmEntry: write((r) => uc.confirmEntry(param(r, 'id'), body(r), meta(r))),
    deleteEntry: write((r) =>
      uc.deleteEntry(param(r, 'id'), q(r)['scope'] as never, meta(r)),
    ),

    // Rotina
    sync: write((r) => uc.syncDaily(meta(r))),
  };
};
