import { dedupeKey } from '@patrimonio/domain';
import type { DateOnly, Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { BadRequestError, ConflictError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { TransactionWrite } from '../../interfaces/transaction.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { planTransfer } from '../../plans/transfer.plan.js';
import type { TransferPlan, TransferPreview } from '../../plans/transfer.plan.js';

const FAR_FUTURE = '9999-12-31';

export type TransferInput = {
  readonly from_portfolio_id: string;
  readonly to_portfolio_id: string;
  readonly asset_id: string;
  readonly institution_id: string;
  readonly trade_date: DateOnly;
  /** A quantidade a mover, ou tudo o que houver na data. */
  readonly quantity?: string | undefined;
  readonly all?: boolean | undefined;
  readonly note?: string | undefined;
  readonly idempotency_key?: string | undefined;
  readonly origin_request_id?: string | undefined;
};

export type TransferResult = {
  readonly transactions: readonly Transaction[];
  readonly preview: TransferPreview;
  readonly queued: readonly EnqueuedEvent[];
};

export type TransferDeps = { readonly unitOfWork: UnitOfWork };

/**
 * Carrega o livro das duas carteiras e monta o plano. As duas pontas são lidas
 * na mesma transação: ler uma depois da outra, fora de transação, deixaria a
 * origem mudar entre as leituras.
 */
const prepareTransfer = async (
  repositories: TransactionalRepositories,
  input: TransferInput,
): Promise<Either<AppError, TransferPlan>> => {
  if (input.from_portfolio_id === input.to_portfolio_id) {
    return failure(
      new BadRequestError('A carteira de origem e a de destino precisam ser diferentes'),
    );
  }

  for (const portfolioId of [input.from_portfolio_id, input.to_portfolio_id]) {
    const portfolio = await repositories.portfolios.findById(portfolioId);
    if (portfolio.isFailure()) return portfolio;
    if (portfolio.value === null) {
      return failure(new NotFoundError(`Carteira ${portfolioId} não encontrada`));
    }
    if (portfolio.value.archived_at !== null) {
      return failure(
        new ConflictError(`A carteira ${portfolio.value.name} está arquivada`),
      );
    }
  }

  const asset = await repositories.assets.findById(input.asset_id);
  if (asset.isFailure()) return asset;
  if (asset.value === null) {
    return failure(new NotFoundError(`Ativo ${input.asset_id} não encontrado`));
  }

  const originEntries = await repositories.ledger.entriesForPortfolioAsset(
    input.from_portfolio_id,
    input.asset_id,
  );
  if (originEntries.isFailure()) return originEntries;

  const destinationEntries = await repositories.ledger.entriesForPortfolioAsset(
    input.to_portfolio_id,
    input.asset_id,
  );
  if (destinationEntries.isFailure()) return destinationEntries;

  const originPortfolio = await repositories.ledger.entriesForPortfolio(
    input.from_portfolio_id,
    FAR_FUTURE,
  );
  if (originPortfolio.isFailure()) return originPortfolio;

  const destinationPortfolio = await repositories.ledger.entriesForPortfolio(
    input.to_portfolio_id,
    FAR_FUTURE,
  );
  if (destinationPortfolio.isFailure()) return destinationPortfolio;

  const context = {
    from_portfolio_id: input.from_portfolio_id,
    to_portfolio_id: input.to_portfolio_id,
    asset_id: input.asset_id,
    trade_date: input.trade_date,
    origin_entries: originEntries.value,
    destination_entries: destinationEntries.value,
    origin_portfolio_entries: originPortfolio.value,
    destination_portfolio_entries: destinationPortfolio.value,
  };

  const available = planTransfer(context, { quantity: '0' }).preview.available_quantity;
  const quantity = input.all === true ? available : (input.quantity ?? '0');

  if (Number(quantity) <= 0) {
    return failure(
      new BadRequestError('A quantidade a mover precisa ser maior que zero'),
    );
  }

  const plan = planTransfer(context, { quantity });

  if (plan.preview.oversold) {
    return failure(
      new BadRequestError(
        `Não há quantidade suficiente na carteira de origem: há ${available} em ` +
          `${input.trade_date}`,
      ),
    );
  }

  return success(plan);
};

/**
 * Mover uma posição de carteira sem vender. O preço médio é preservado nas duas
 * pontas, não há resultado realizado nem imposto, e as duas pernas nascem na
 * mesma transação — uma perna sozinha quebraria o patrimônio total, e o trigger
 * diferido do banco recusa isso de todo jeito.
 */
export const transferPosition = (deps: TransferDeps) =>
  either(async function* (input: TransferInput) {
    return yield* await deps.unitOfWork.run<AppError, TransferResult>(
      async (repositories) => {
        const prepared = await prepareTransfer(repositories, input);
        if (prepared.isFailure()) return prepared;

        const plan = prepared.value;
        const groupId = repositories.transactions.nextId();

        const rows: TransactionWrite[] = plan.legs.map((leg) => ({
          kind: 'transfer',
          trade_date: input.trade_date,
          // Transferência não tem liquidação futura: nada sai da conta.
          settlement_date: input.trade_date,
          portfolio_id: leg.portfolio_id,
          asset_id: input.asset_id,
          institution_id: input.institution_id,
          quantity: leg.quantity,
          unit_price: leg.unit_price,
          fees: '0',
          gross_amount: leg.amount,
          net_amount: leg.outgoing ? `-${leg.amount}` : leg.amount,
          transfer_group_id: groupId,
          ...(input.note === undefined ? {} : { note: input.note }),
          ...(leg.outgoing || input.idempotency_key === undefined
            ? {}
            : { idempotency_key: input.idempotency_key }),
        }));

        const inserted = await repositories.transactions.insertMany(rows);
        if (inserted.isFailure()) return inserted;

        const origin =
          input.origin_request_id === undefined
            ? {}
            : { origin_request_id: input.origin_request_id };

        const enqueued = await repositories.outbox.enqueue([
          {
            stage: 'recalc',
            dedupe_key: dedupeKey.recalc(input.from_portfolio_id),
            payload: {
              portfolio_id: input.from_portfolio_id,
              from_date: input.trade_date,
            },
            ...origin,
          },
          {
            stage: 'recalc',
            dedupe_key: dedupeKey.recalc(input.to_portfolio_id),
            payload: {
              portfolio_id: input.to_portfolio_id,
              from_date: input.trade_date,
            },
            ...origin,
          },
        ]);
        if (enqueued.isFailure()) return enqueued;

        return success({
          transactions: inserted.value,
          preview: plan.preview,
          queued: enqueued.value,
        });
      },
      // A trava é da origem: é dela que a quantidade sai, e é ela que não pode
      // ser lida por dois pedidos ao mesmo tempo.
      { lock: `portfolio:${input.from_portfolio_id}` },
    );
  });

/** O mesmo plano, sem gravar: é o que o modal mostra antes de mover. */
export const previewTransfer = (deps: TransferDeps) =>
  either(async function* (input: TransferInput) {
    return yield* await deps.unitOfWork.run<AppError, TransferPreview>(
      async (repositories) => {
        const prepared = await prepareTransfer(repositories, input);
        if (prepared.isFailure()) return prepared;

        return success(prepared.value.preview);
      },
    );
  });
