import { finance as fin } from '@patrimonio/calc';
import type { Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { FinanceError } from '../../errors/finance-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import type { TransactionPreview } from '../../plans/transaction.plan.js';
import { BadRequestError } from '../../errors/app-error.js';
import { financeClock } from '../finance/clock.js';
import { findReplay } from '../transaction/idempotency.js';
import {
  portfolioLock,
  prepareTransaction,
} from '../transaction/createTransaction.usecase.js';
import type { CreateTransactionInput } from '../transaction/createTransaction.usecase.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';

/**
 * LIV-03 · Aporte: conta → carteira, numa operação só.
 *
 * Grava a compra na carteira e, quando a origem é uma conta, a saída na conta —
 * as duas na mesma transação, ligadas por um `event_id`, com o recálculo da
 * carteira na `pipeline_outbox` dentro dela (LIV-13). Origem "Fora do app"
 * (`account_id` nulo) grava só a perna de posição (RN-U7).
 */

export type ContributionInput = Omit<CreateTransactionInput, 'kind'> & {
  /** A conta de onde o dinheiro sai; `null` é "Fora do app". */
  readonly account_id: string | null;
  /** O recorrente de aporte que este lançamento cumpre: o previsto do mês some (LIV-11). */
  readonly recurring_id?: string | undefined;
  readonly preview?: boolean | undefined;
};

export type AccountEffect = {
  readonly account_id: string;
  readonly before: string;
  readonly after: string;
};

export type ContributionResult = {
  readonly transaction: Transaction | null;
  readonly preview: TransactionPreview | null;
  /** O valor do aporte: quantidade × preço + taxas. */
  readonly amount: string;
  readonly account: AccountEffect | null;
  readonly queued: EnqueuedEvent | null;
  readonly replayed: boolean;
  readonly event_id: string | null;
};

export type ContributionDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
};

const rule = (code: string, message: string, field?: string, status = 422) =>
  failure(
    new FinanceError(
      [{ code, message, ...(field === undefined ? {} : { field }) }],
      status,
    ),
  );

export const createContribution = (deps: ContributionDeps) =>
  either(async function* (input: ContributionInput) {
    return yield* await deps.unitOfWork.run<AppError, ContributionResult>(
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
              queued: null,
              replayed: true,
              event_id: null,
            });
          }
        }

        // RN-03: aporte só aceita hoje ou passado; o futuro nasce de um recorrente.
        if (input.trade_date > today) {
          return rule(
            'DATA_FUTURA',
            'Aporte só aceita hoje ou uma data passada. Para o futuro, use um aporte recorrente.',
            'trade_date',
          );
        }

        let snapshot: Awaited<ReturnType<typeof repositories.finance.load>> | null = null;
        if (input.account_id !== null) {
          snapshot = await repositories.finance.load();
          if (snapshot.isFailure()) return snapshot;
          const data = snapshot.value;
          if (data.cards.some((card) => card.id === input.account_id)) {
            return rule(
              'APORTE_ORIGEM_CARTAO',
              'O aporte não pode sair de um cartão. Escolha uma conta ou "Fora do app".',
              'account_id',
            );
          }
          const account = data.accounts.find((a) => a.id === input.account_id);
          if (account === undefined) {
            return rule(
              'CONTA_NAO_ENCONTRADA',
              'A conta de origem não existe.',
              'account_id',
              404,
            );
          }
          if (account.archived) {
            return rule(
              'CONTA_ARQUIVADA',
              'A conta de origem está arquivada.',
              'account_id',
              409,
            );
          }
        }

        if (input.recurring_id !== undefined) {
          const loaded = await repositories.finance.load();
          if (loaded.isFailure()) return loaded;
          const recurring = loaded.value.recurrings.find(
            (r) => r.id === input.recurring_id,
          );
          if (recurring === undefined || recurring.kind !== 'aporte') {
            return rule(
              'RECORRENTE_APORTE_NAO_ENCONTRADO',
              'O aporte recorrente não existe.',
              'recurring_id',
              404,
            );
          }
        }

        const prepared = await prepareTransaction(
          repositories,
          { ...input, kind: 'buy' },
          { create: !isPreview },
        );
        if (prepared.isFailure()) return prepared;
        const { row, plan } = prepared.value;
        const amount = fin.money(fin.dec(row.net_amount).abs());

        const eventId = repositories.transactions.nextId();
        let leg: fin.FinChanges | null = null;
        let account: AccountEffect | null = null;

        if (snapshot !== null && snapshot.isSuccess() && input.account_id !== null) {
          const before = snapshot.value;
          const found =
            row.asset_id === null || row.asset_id === undefined
              ? null
              : await repositories.assets.findById(row.asset_id);
          const ticker =
            found !== null && found.isSuccess() && found.value !== null
              ? found.value.ticker
              : (input.asset?.ticker.toUpperCase() ?? 'carteira');
          const after = {
            ...before,
            movements: [
              ...before.movements,
              {
                id: repositories.transactions.nextId(),
                date: input.trade_date,
                account_id: input.account_id,
                kind: 'aporte' as const,
                amount: `-${amount}`,
                description: `Aporte em ${ticker}`,
                note: null,
                transfer_id: null,
                event_id: eventId,
              },
            ],
          };
          account = {
            account_id: input.account_id,
            before: fin.money(fin.accountBalance(before, input.account_id, today)),
            after: fin.money(fin.accountBalance(after, input.account_id, today)),
          };
          leg = fin.diffSnapshots(before, after);
        }

        if (isPreview) {
          return success({
            transaction: null,
            preview: plan.preview,
            amount,
            account,
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
          return failure(new BadRequestError('O aporte não pôde ser gravado'));
        }

        if (leg !== null) {
          const saved = await repositories.finance.persist(leg);
          if (saved.isFailure()) return saved;
        }

        if (input.recurring_id !== undefined) {
          // Lançado o aporte do mês, o previsto some: mesma chave do "pular mês".
          const loaded = await repositories.finance.load();
          if (loaded.isFailure()) return loaded;
          const settled = fin.skipMonth(
            loaded.value,
            input.recurring_id,
            fin.monthKey(input.trade_date),
          );
          const saved = await repositories.finance.persist(
            fin.diffSnapshots(loaded.value, settled),
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
          queued: enqueued.value[0] ?? null,
          replayed: false,
          event_id: leg === null ? null : eventId,
        });
      },
      { locks: ['finance', portfolioLock(input.portfolio_id)] },
    );
  });
