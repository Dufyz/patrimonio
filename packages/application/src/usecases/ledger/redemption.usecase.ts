import { finance as fin } from '@patrimonio/calc';
import type { Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import { FinanceError } from '../../errors/finance-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import type { TransactionPreview } from '../../plans/transaction.plan.js';
import { financeClock } from '../finance/clock.js';
import {
  portfolioLock,
  prepareTransaction,
} from '../transaction/createTransaction.usecase.js';
import type { CreateTransactionInput } from '../transaction/createTransaction.usecase.js';
import { findReplay } from '../transaction/idempotency.js';
import type { AccountEffect } from './contribution.usecase.js';

/**
 * LIV-04 · Resgate: carteira → conta, com despesa ligada opcional.
 *
 * O resgate credita a conta, reduz a posição e não entra em Receitas nem no Saldo
 * do mês (RN-U1). Com "gerar despesa ligada" grava, na mesma transação, uma
 * despesa de mesmo dia e valor, ligada pelo `event_id`: o patrimônio cai pela
 * despesa, não pelo resgate (RN-U6).
 */

export type LinkedExpense = {
  readonly category_id: string;
  readonly description?: string | undefined;
};

export type RedemptionInput = Omit<CreateTransactionInput, 'kind'> & {
  /** A conta que recebe; `null` é "Fora do app". */
  readonly account_id: string | null;
  readonly linked_expense?: LinkedExpense | undefined;
  readonly preview?: boolean | undefined;
};

export type RedemptionResult = {
  readonly transaction: Transaction | null;
  readonly preview: TransactionPreview | null;
  readonly amount: string;
  readonly account: AccountEffect | null;
  readonly expense_id: string | null;
  readonly queued: EnqueuedEvent | null;
  readonly replayed: boolean;
  readonly event_id: string | null;
};

export type RedemptionDeps = { readonly unitOfWork: UnitOfWork; readonly clock: Clock };

const rule = (code: string, message: string, field?: string, status = 422) =>
  failure(
    new FinanceError(
      [{ code, message, ...(field === undefined ? {} : { field }) }],
      status,
    ),
  );

export const createRedemption = (deps: RedemptionDeps) =>
  either(async function* (input: RedemptionInput) {
    return yield* await deps.unitOfWork.run<AppError, RedemptionResult>(
      async (repositories) => {
        const today = financeClock(deps.clock).today();
        const isPreview = input.preview === true;

        if (!isPreview) {
          const replay = await findReplay(repositories, input.idempotency_key);
          if (replay.isFailure()) return replay;
          if (replay.value !== null) {
            return success({
              transaction: replay.value,
              preview: null,
              amount: replay.value.net_amount,
              account: null,
              expense_id: null,
              queued: null,
              replayed: true,
              event_id: null,
            });
          }
        }

        if (input.trade_date > today) {
          return rule(
            'DATA_FUTURA',
            'O resgate só aceita hoje ou uma data passada.',
            'trade_date',
          );
        }
        if (input.linked_expense !== undefined && input.account_id === null) {
          return rule(
            'DESPESA_LIGADA_SEM_CONTA',
            'Para gerar a despesa ligada, escolha a conta que recebe o resgate.',
            'account_id',
          );
        }

        const loaded = await repositories.finance.load();
        if (loaded.isFailure()) return loaded;
        const before = loaded.value;

        if (input.account_id !== null) {
          if (before.cards.some((card) => card.id === input.account_id)) {
            return rule(
              'RESGATE_DESTINO_CARTAO',
              'O resgate não pode ir para um cartão. Escolha uma conta.',
              'account_id',
            );
          }
          const account = before.accounts.find((a) => a.id === input.account_id);
          if (account === undefined) {
            return rule(
              'CONTA_NAO_ENCONTRADA',
              'A conta de destino não existe.',
              'account_id',
              404,
            );
          }
          if (account.archived) {
            return rule(
              'CONTA_ARQUIVADA',
              'A conta de destino está arquivada.',
              'account_id',
              409,
            );
          }
        }

        const prepared = await prepareTransaction(
          repositories,
          { ...input, kind: 'sell' },
          { create: !isPreview },
        );
        if (prepared.isFailure()) {
          const error = prepared.value;
          if (
            error instanceof BadRequestError &&
            error.message.startsWith('Não há quantidade suficiente')
          ) {
            return rule('RESGATE_ACIMA_DA_POSICAO', error.message, 'quantity');
          }
          return prepared;
        }
        const { row, plan } = prepared.value;
        const amount = fin.money(fin.dec(row.net_amount).abs());
        const eventId = repositories.transactions.nextId();

        let after = before;
        let expenseId: string | null = null;
        let account: AccountEffect | null = null;

        if (input.account_id !== null) {
          const found =
            row.asset_id === null || row.asset_id === undefined
              ? null
              : await repositories.assets.findById(row.asset_id);
          const ticker =
            found !== null && found.isSuccess() && found.value !== null
              ? found.value.ticker
              : (input.asset?.ticker.toUpperCase() ?? 'carteira');
          after = {
            ...after,
            movements: [
              ...after.movements,
              {
                id: repositories.transactions.nextId(),
                date: input.trade_date,
                account_id: input.account_id,
                kind: 'resgate' as const,
                amount,
                description: `Resgate de ${ticker}`,
                note: null,
                transfer_id: null,
                event_id: eventId,
              },
            ],
          };

          if (input.linked_expense !== undefined) {
            const created = fin.createEntries(
              after,
              {
                kind: 'despesa',
                description:
                  input.linked_expense.description ?? `Pago com resgate de ${ticker}`,
                date: input.trade_date,
                category_id: input.linked_expense.category_id,
                amount,
                payments: [{ source_type: 'conta', source_id: input.account_id }],
              },
              today,
              () => repositories.transactions.nextId(),
            );
            if (created.isFailure()) return failure(toFinanceError(created.value));
            const expense = created.value.created[0];
            if (expense === undefined) {
              return failure(new BadRequestError('A despesa ligada não pôde ser criada'));
            }
            expenseId = expense.id;
            after = {
              ...created.value.data,
              entries: created.value.data.entries.map((e) =>
                e.id === expense.id ? { ...e, event_id: eventId } : e,
              ),
            };
          }

          account = {
            account_id: input.account_id,
            before: fin.money(fin.accountBalance(before, input.account_id, today)),
            after: fin.money(fin.accountBalance(after, input.account_id, today)),
          };
        }

        if (isPreview) {
          return success({
            transaction: null,
            preview: plan.preview,
            amount,
            account,
            expense_id: expenseId,
            queued: null,
            replayed: false,
            event_id: null,
          });
        }

        const inserted = await repositories.transactions.insertMany([
          { ...row, event_id: eventId },
        ]);
        if (inserted.isFailure()) return inserted;
        const transaction = inserted.value[0];
        if (transaction === undefined) {
          return failure(new BadRequestError('O resgate não pôde ser gravado'));
        }

        if (after !== before) {
          const saved = await repositories.finance.persist(
            fin.diffSnapshots(before, after),
          );
          if (saved.isFailure()) return saved;
        }

        const enqueued = await repositories.outbox.enqueue(plan.events);
        if (enqueued.isFailure()) return enqueued;

        return success({
          transaction,
          preview: plan.preview,
          amount,
          account,
          expense_id: expenseId,
          queued: enqueued.value[0] ?? null,
          replayed: false,
          event_id: after === before ? null : eventId,
        });
      },
      { locks: ['finance', portfolioLock(input.portfolio_id)] },
    );
  });

const toFinanceError = (errors: readonly fin.FinRuleError[]): FinanceError =>
  new FinanceError(
    errors.map((e) => ({
      code: e.code,
      message: e.message,
      field: e.field,
      details: e.details,
    })),
    errors[0]?.status ?? 422,
  );
