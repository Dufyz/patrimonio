import { cashAssetName, cashAssetTicker, dedupeKey } from '@patrimonio/domain';
import type { Asset, DateOnly, Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { BadRequestError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { TransactionWrite } from '../../interfaces/transaction.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import type { TransactionPreview } from '../../plans/transaction.plan.js';
import { createAssetIn } from '../asset/asset.usecases.js';
import { portfolioLock, prepareTransaction } from './createTransaction.usecase.js';
import { findReplay, replayGroup } from './idempotency.js';

/**
 * O caixa é um ativo sintético por instituição, criado na primeira vez que
 * dinheiro entra ali. Assim o aporte é um lançamento como os outros e o
 * dinheiro parado aparece em Posições e na alocação, em vez de virar uma coluna
 * de saldo que nenhuma tela soma.
 */
export const ensureCashAsset = async (
  repositories: TransactionalRepositories,
  institutionId: string,
): Promise<Either<AppError, Asset>> => {
  const institution = await repositories.institutions.findById(institutionId);
  if (institution.isFailure()) return institution;
  if (institution.value === null) {
    return failure(new BadRequestError('A instituição informada não existe'));
  }

  const ticker = cashAssetTicker(institution.value.name);

  const existing = await repositories.assets.findByTicker(ticker);
  if (existing.isFailure()) return existing;
  if (existing.value !== null) return success(existing.value);

  return createAssetIn(repositories, {
    ticker,
    name: cashAssetName(institution.value.name),
    origin: 'manual',
    b3_type: 'cash',
    issuer_id: institutionId,
    // Caixa não tem cotação: o valor dele é o próprio saldo.
    price_source: 'manual',
    liquidity: 'daily',
  });
};

export type CashMovementInput = {
  readonly kind: 'deposit' | 'withdrawal';
  readonly portfolio_id: string;
  readonly institution_id: string;
  readonly trade_date: DateOnly;
  readonly settlement_date?: DateOnly | undefined;
  readonly amount: string;
  readonly fees?: string | undefined;
  readonly note?: string | undefined;
  /**
   * De fora do app conta como aporte no gráfico de origem do crescimento; de
   * outra carteira vira transferência, e o patrimônio total não muda.
   */
  readonly source?: 'external' | 'other_portfolio' | undefined;
  readonly from_portfolio_id?: string | undefined;
  readonly idempotency_key?: string | undefined;
  readonly origin_request_id?: string | undefined;
};

export type CashMovementResult = {
  readonly transactions: readonly Transaction[];
  /** Nulo no replay: o preview é do estado em que o lançamento foi criado. */
  readonly preview: TransactionPreview | null;
  readonly queued: readonly EnqueuedEvent[];
  readonly replayed: boolean;
};

export type CashMovementDeps = { readonly unitOfWork: UnitOfWork };

export const createCashMovement = (deps: CashMovementDeps) =>
  either(async function* (input: CashMovementInput) {
    return yield* await deps.unitOfWork.run<AppError, CashMovementResult>(
      async (repositories) => {
        const replay = await findReplay(repositories, input.idempotency_key);
        if (replay.isFailure()) return replay;

        if (replay.value !== null) {
          const group = await replayGroup(repositories, replay.value);
          if (group.isFailure()) return group;

          return success({
            transactions: group.value,
            preview: null,
            queued: [],
            replayed: true,
          });
        }

        const cash = await ensureCashAsset(repositories, input.institution_id);
        if (cash.isFailure()) return cash;

        const source = input.source ?? 'external';

        if (source === 'other_portfolio') {
          return moveCashBetweenPortfolios(repositories, input, cash.value);
        }

        const prepared = await prepareTransaction(repositories, {
          kind: input.kind,
          portfolio_id: input.portfolio_id,
          institution_id: input.institution_id,
          asset_id: cash.value.id,
          trade_date: input.trade_date,
          ...(input.settlement_date === undefined
            ? {}
            : { settlement_date: input.settlement_date }),
          quantity: input.amount,
          // O caixa vale um real por real: a quantidade é o próprio valor.
          unit_price: '1',
          ...(input.fees === undefined ? {} : { fees: input.fees }),
          ...(input.note === undefined ? {} : { note: input.note }),
          ...(input.idempotency_key === undefined
            ? {}
            : { idempotency_key: input.idempotency_key }),
          ...(input.origin_request_id === undefined
            ? {}
            : { origin_request_id: input.origin_request_id }),
        });
        if (prepared.isFailure()) return prepared;

        const inserted = await repositories.transactions.insertMany([prepared.value.row]);
        if (inserted.isFailure()) return inserted;

        const enqueued = await repositories.outbox.enqueue(prepared.value.plan.events);
        if (enqueued.isFailure()) return enqueued;

        return success({
          transactions: inserted.value,
          preview: prepared.value.plan.preview,
          queued: enqueued.value,
          replayed: false,
        });
      },
      { lock: portfolioLock(input.portfolio_id) },
    );
  });

/**
 * Dinheiro que veio de outra carteira não é aporte novo: é transferência. As
 * duas pernas nascem na mesma transação, ligadas pelo mesmo grupo, e o
 * patrimônio total não muda — só a leitura por propósito.
 */
const moveCashBetweenPortfolios = async (
  repositories: TransactionalRepositories,
  input: CashMovementInput,
  cash: Asset,
): Promise<Either<AppError, CashMovementResult>> => {
  const from = input.from_portfolio_id;

  if (from === undefined || from === input.portfolio_id) {
    return failure(
      new BadRequestError(
        'Dinheiro vindo de outra carteira precisa da carteira de origem, diferente do destino',
      ),
    );
  }

  const origin = await repositories.portfolios.findById(from);
  if (origin.isFailure()) return origin;
  if (origin.value === null) {
    return failure(new NotFoundError(`Carteira ${from} não encontrada`));
  }

  const prepared = await prepareTransaction(repositories, {
    kind: input.kind,
    portfolio_id: input.portfolio_id,
    institution_id: input.institution_id,
    asset_id: cash.id,
    trade_date: input.trade_date,
    ...(input.settlement_date === undefined
      ? {}
      : { settlement_date: input.settlement_date }),
    quantity: input.amount,
    unit_price: '1',
    ...(input.origin_request_id === undefined
      ? {}
      : { origin_request_id: input.origin_request_id }),
  });
  if (prepared.isFailure()) return prepared;

  const groupId = repositories.transactions.nextId();
  const settlement = prepared.value.row.settlement_date;

  const leg = (portfolioId: string, outgoing: boolean): TransactionWrite => ({
    kind: 'transfer',
    trade_date: input.trade_date,
    settlement_date: settlement,
    portfolio_id: portfolioId,
    asset_id: cash.id,
    institution_id: input.institution_id,
    quantity: input.amount,
    unit_price: '1',
    fees: '0',
    gross_amount: prepared.value.row.gross_amount,
    net_amount: outgoing
      ? `-${prepared.value.row.gross_amount}`
      : prepared.value.row.gross_amount,
    transfer_group_id: groupId,
    ...(input.note === undefined ? {} : { note: input.note }),
  });

  const inserted = await repositories.transactions.insertMany([
    leg(from, true),
    leg(input.portfolio_id, false),
  ]);
  if (inserted.isFailure()) return inserted;

  const origin_request_id =
    input.origin_request_id === undefined
      ? {}
      : { origin_request_id: input.origin_request_id };

  // As duas carteiras mudaram: as duas precisam de recálculo a partir da data.
  const enqueued = await repositories.outbox.enqueue([
    {
      stage: 'recalc',
      dedupe_key: dedupeKey.recalc(from),
      payload: { portfolio_id: from, from_date: input.trade_date },
      ...origin_request_id,
    },
    {
      stage: 'recalc',
      dedupe_key: dedupeKey.recalc(input.portfolio_id),
      payload: { portfolio_id: input.portfolio_id, from_date: input.trade_date },
      ...origin_request_id,
    },
  ]);
  if (enqueued.isFailure()) return enqueued;

  return success({
    transactions: inserted.value,
    preview: prepared.value.plan.preview,
    queued: enqueued.value,
    replayed: false,
  });
};
