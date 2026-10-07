import type {
  B3Type,
  DateOnly,
  PayoutKind,
  Transaction,
  TransactionKind,
} from '@patrimonio/domain';
import { settlementBusinessDays } from '@patrimonio/domain';
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
import { planTransaction } from '../../plans/transaction.plan.js';
import type { TransactionDraft, TransactionPreview } from '../../plans/transaction.plan.js';
import { classifyWithRules, createAssetIn } from '../asset/asset.usecases.js';
import { loadPlanContext } from './context.js';

/**
 * Ativo que ainda não existe no cadastro: ação, FII, ETF, BDR e Tesouro entram
 * no primeiro lançamento que os usa, sem cadastro prévio.
 */
export type NewAssetInput = {
  readonly ticker: string;
  readonly name: string;
  readonly b3_type?: B3Type | undefined;
  readonly sector?: string | undefined;
  readonly category_id?: string | null | undefined;
};

export type CreateTransactionInput = {
  readonly kind: TransactionKind;
  readonly portfolio_id: string;
  readonly institution_id: string;
  readonly asset_id?: string | undefined;
  readonly asset?: NewAssetInput | undefined;
  readonly trade_date: DateOnly;
  /** Sugerida pelo tipo do ativo quando não vem, e sempre editável. */
  readonly settlement_date?: DateOnly | undefined;
  readonly quantity: string;
  readonly unit_price: string;
  /** Sugerida pela regra da instituição quando não vem. */
  readonly fees?: string | undefined;
  readonly tax_withheld?: string | undefined;
  readonly payout_kind?: PayoutKind | undefined;
  readonly record_date?: DateOnly | undefined;
  readonly note?: string | undefined;
  readonly idempotency_key?: string | undefined;
  readonly origin_request_id?: string | undefined;
};

export type TransactionResult = {
  readonly transaction: Transaction;
  readonly preview: TransactionPreview;
  readonly queued: EnqueuedEvent | null;
  /** A mesma `Idempotency-Key` de novo: nada foi gravado, e a resposta é a mesma. */
  readonly replayed: boolean;
};

export type CreateTransactionDeps = { readonly unitOfWork: UnitOfWork };

/** A trava é por carteira: dois lançamentos na mesma carteira serializam. */
export const portfolioLock = (portfolioId: string): string => `portfolio:${portfolioId}`;

export type ResolvedAsset = {
  readonly id: string;
  readonly ticker: string;
  readonly b3_type: B3Type | null;
  readonly origin: 'market' | 'manual';
  readonly category_id: string | null;
  readonly is_new: boolean;
};

/**
 * O id do ativo hipotético do preview. Um ticker que ainda não existe precisa
 * de posição "antes" igual a zero, e criar o cadastro para mostrar um preview
 * deixaria ativo órfão toda vez que alguém fechasse o modal.
 */
export const DRAFT_ASSET_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Resolve o ativo do lançamento: o que já existe vem por id ou por código, e o
 * que não existe é criado aqui — com a categoria que a regra automática der.
 * No preview nada é criado: o ativo é hipotético.
 */
export const resolveAsset = async (
  repositories: TransactionalRepositories,
  input: {
    readonly asset_id?: string | undefined;
    readonly asset?: NewAssetInput | undefined;
  },
  options: { readonly create: boolean },
): Promise<Either<AppError, ResolvedAsset | null>> => {
  if (input.asset_id !== undefined) {
    const found = await repositories.assets.findById(input.asset_id);
    if (found.isFailure()) return found;
    if (found.value === null) {
      return failure(new NotFoundError(`Ativo ${input.asset_id} não encontrado`));
    }

    return success({
      id: found.value.id,
      ticker: found.value.ticker,
      b3_type: found.value.b3_type,
      origin: found.value.origin,
      category_id: found.value.category_id,
      is_new: false,
    });
  }

  if (input.asset === undefined) return success(null);

  const existing = await repositories.assets.findByTicker(input.asset.ticker);
  if (existing.isFailure()) return existing;

  if (existing.value !== null) {
    return success({
      id: existing.value.id,
      ticker: existing.value.ticker,
      b3_type: existing.value.b3_type,
      origin: existing.value.origin,
      category_id: existing.value.category_id,
      is_new: false,
    });
  }

  if (!options.create) {
    const categories = await repositories.categories.list();
    if (categories.isFailure()) return categories;

    return success({
      id: DRAFT_ASSET_ID,
      ticker: input.asset.ticker.toUpperCase(),
      b3_type: input.asset.b3_type ?? null,
      origin: 'market',
      category_id:
        input.asset.category_id ??
        classifyWithRules(
          {
            b3_type: input.asset.b3_type,
            origin: 'market',
            sector: input.asset.sector,
          },
          categories.value,
        ),
      is_new: true,
    });
  }

  const created = await createAssetIn(repositories, {
    ticker: input.asset.ticker.toUpperCase(),
    name: input.asset.name,
    origin: 'market',
    b3_type: input.asset.b3_type ?? null,
    sector: input.asset.sector ?? null,
    category_id: input.asset.category_id,
  });
  if (created.isFailure()) return created;

  return success({
    id: created.value.id,
    ticker: created.value.ticker,
    b3_type: created.value.b3_type,
    origin: created.value.origin,
    category_id: created.value.category_id,
    is_new: true,
  });
};

/**
 * Liquidação sugerida pelo tipo do ativo, contada em dia útil: uma compra na
 * sexta liquida na terça, e numa semana com feriado liquida depois. É sugestão,
 * não imposição — a data que vem no corpo sempre vence.
 */
export const resolveSettlement = async (
  repositories: TransactionalRepositories,
  input: {
    readonly trade_date: DateOnly;
    readonly settlement_date?: DateOnly | undefined;
    readonly asset: ResolvedAsset | null;
  },
): Promise<Either<AppError, DateOnly>> => {
  if (input.settlement_date !== undefined) return success(input.settlement_date);
  if (input.asset === null) return success(input.trade_date);

  const days = settlementBusinessDays(input.asset.b3_type, input.asset.origin);
  if (days === 0) return success(input.trade_date);

  return repositories.businessDays.shiftBusinessDays(input.trade_date, days);
};

/** Taxas sugeridas pela regra da instituição, e sobrescritíveis pelo corpo. */
export const resolveFees = async (
  repositories: TransactionalRepositories,
  input: {
    readonly kind: TransactionKind;
    readonly institution_id: string;
    readonly fees?: string | undefined;
  },
): Promise<Either<AppError, string>> => {
  if (input.fees !== undefined) return success(input.fees);
  if (input.kind !== 'buy' && input.kind !== 'sell') return success('0');

  const institution = await repositories.institutions.findById(input.institution_id);
  if (institution.isFailure()) return institution;
  if (institution.value === null) {
    return failure(new BadRequestError('A instituição informada não existe'));
  }

  return success(institution.value.brokerage_per_order);
};

export const createTransaction = (deps: CreateTransactionDeps) =>
  either(async function* (input: CreateTransactionInput) {
    return yield* await deps.unitOfWork.run<AppError, TransactionResult>(
      async (repositories) => {
        // Clique duplo chega como dois requests com a mesma chave: o segundo
        // devolve o primeiro lançamento, em vez de criar outro.
        if (input.idempotency_key !== undefined) {
          const replay = await repositories.transactions.findByIdempotencyKey(
            input.idempotency_key,
          );
          if (replay.isFailure()) return replay;

          if (replay.value !== null) {
            const asset =
              replay.value.asset_id === null
                ? null
                : await repositories.assets.findById(replay.value.asset_id);
            if (asset !== null && asset.isFailure()) return asset;

            const context = await loadPlanContext(repositories, {
              portfolio_id: replay.value.portfolio_id,
              asset:
                asset === null || asset.value === null
                  ? null
                  : {
                      id: asset.value.id,
                      ticker: asset.value.ticker,
                      category_id: asset.value.category_id,
                      is_new: false,
                    },
              institution_id: replay.value.institution_id,
              replacing: replay.value,
            });
            if (context.isFailure()) return context;

            const plan = planTransaction(context.value, toDraft(replay.value));

            return success({
              transaction: replay.value,
              preview: plan.preview,
              queued: null,
              replayed: true,
            });
          }
        }

        const prepared = await prepareTransaction(repositories, input);
        if (prepared.isFailure()) return prepared;

        const { row, plan } = prepared.value;

        const inserted = await repositories.transactions.insertMany([row]);
        if (inserted.isFailure()) return inserted;

        const transaction = inserted.value[0];
        if (transaction === undefined) {
          return failure(new BadRequestError('O lançamento não pôde ser gravado'));
        }

        // O evento vai na mesma transação do lançamento: ou os dois existem, ou
        // nenhum existe — e assim abortar não deixa evento órfão na outbox.
        const enqueued = await repositories.outbox.enqueue(plan.events);
        if (enqueued.isFailure()) return enqueued;

        return success({
          transaction,
          preview: plan.preview,
          queued: enqueued.value[0] ?? null,
          replayed: false,
        });
      },
      { lock: portfolioLock(input.portfolio_id) },
    );
  });

/** O lançamento gravado de volta na forma de rascunho, para replanejar. */
const toDraft = (transaction: Transaction): TransactionDraft => ({
  id: transaction.id,
  kind: transaction.kind,
  trade_date: transaction.trade_date,
  settlement_date: transaction.settlement_date,
  quantity: transaction.quantity,
  unit_price: transaction.unit_price,
  fees: transaction.fees,
  tax_withheld: transaction.tax_withheld,
  ...(transaction.payout_kind === null ? {} : { payout_kind: transaction.payout_kind }),
  ...(transaction.record_date === null ? {} : { record_date: transaction.record_date }),
  ...(transaction.note === null ? {} : { note: transaction.note }),
});

export type PreparedTransaction = {
  readonly row: TransactionWrite;
  readonly plan: ReturnType<typeof planTransaction>;
};

export type PrepareOptions = {
  readonly replacing?: Transaction | undefined;
  /** No preview nada é criado: o ativo novo é hipotético. */
  readonly create?: boolean | undefined;
};

/**
 * O caminho comum do preview e da gravação: o mesmo plano, com os mesmos
 * números. O teste roda o mesmo cenário nos dois modos e compara campo a campo,
 * porque um preview que diverge do que fica gravado acaba com a confiança no app.
 */
export const prepareTransaction = async (
  repositories: TransactionalRepositories,
  input: CreateTransactionInput,
  options: PrepareOptions = {},
): Promise<Either<AppError, PreparedTransaction>> => {
  const portfolio = await repositories.portfolios.findById(input.portfolio_id);
  if (portfolio.isFailure()) return portfolio;
  if (portfolio.value === null) {
    return failure(new NotFoundError(`Carteira ${input.portfolio_id} não encontrada`));
  }
  if (portfolio.value.archived_at !== null) {
    return failure(
      new ConflictError('A carteira está arquivada: reative-a para lançar nela'),
    );
  }

  const asset = await resolveAsset(repositories, input, {
    create: options.create !== false,
  });
  if (asset.isFailure()) return asset;

  if (asset.value === null && input.kind !== 'deposit' && input.kind !== 'withdrawal') {
    return failure(
      new BadRequestError('Este tipo de lançamento precisa de um ativo'),
    );
  }

  const settlement = await resolveSettlement(repositories, {
    trade_date: input.trade_date,
    settlement_date: input.settlement_date,
    asset: asset.value,
  });
  if (settlement.isFailure()) return settlement;

  if (settlement.value < input.trade_date) {
    return failure(
      new BadRequestError('A liquidação não pode ser anterior à data da operação'),
    );
  }

  const fees = await resolveFees(repositories, {
    kind: input.kind,
    institution_id: input.institution_id,
    fees: input.fees,
  });
  if (fees.isFailure()) return fees;

  const context = await loadPlanContext(repositories, {
    portfolio_id: input.portfolio_id,
    asset:
      asset.value === null
        ? null
        : {
            id: asset.value.id,
            ticker: asset.value.ticker,
            category_id: asset.value.category_id,
            is_new: asset.value.is_new,
          },
    institution_id: input.institution_id,
    replacing: options.replacing,
    origin_request_id: input.origin_request_id,
  });
  if (context.isFailure()) return context;

  const draft: TransactionDraft = {
    ...(options.replacing === undefined ? {} : { id: options.replacing.id }),
    kind: input.kind,
    trade_date: input.trade_date,
    settlement_date: settlement.value,
    quantity: input.quantity,
    unit_price: input.unit_price,
    fees: fees.value,
    ...(input.tax_withheld === undefined ? {} : { tax_withheld: input.tax_withheld }),
    ...(input.payout_kind === undefined ? {} : { payout_kind: input.payout_kind }),
    ...(input.record_date === undefined ? {} : { record_date: input.record_date }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };

  const plan = planTransaction(context.value, draft);

  // Venda acima da quantidade disponível é recusada: a posição não fica
  // negativa, e descobrir isso seis meses depois sairia caro.
  if (plan.preview.oversold) {
    return failure(
      new BadRequestError(
        `Não há quantidade suficiente: a posição em ${input.trade_date} é de ` +
          `${plan.preview.position.quantity.before}`,
      ),
    );
  }

  const row: TransactionWrite = {
    ...(options.replacing === undefined ? {} : { id: options.replacing.id }),
    kind: input.kind,
    trade_date: input.trade_date,
    settlement_date: settlement.value,
    portfolio_id: input.portfolio_id,
    asset_id: asset.value === null || asset.value.id === DRAFT_ASSET_ID ? null : asset.value.id,
    institution_id: input.institution_id,
    quantity: input.quantity,
    unit_price: input.unit_price,
    fees: fees.value,
    gross_amount: plan.amounts.gross_amount,
    net_amount: plan.amounts.net_amount,
    ...(input.tax_withheld === undefined ? {} : { tax_withheld: input.tax_withheld }),
    ...(input.payout_kind === undefined ? {} : { payout_kind: input.payout_kind }),
    ...(input.record_date === undefined ? {} : { record_date: input.record_date }),
    ...(input.note === undefined ? {} : { note: input.note }),
    ...(input.idempotency_key === undefined
      ? {}
      : { idempotency_key: input.idempotency_key }),
  };

  return success({ row, plan });
};

/**
 * O mesmo plano, em modo que não grava. A lista de eventos vem vazia, e os
 * números são idênticos aos da gravação.
 */
export const previewTransaction = (deps: CreateTransactionDeps) =>
  either(async function* (input: CreateTransactionInput) {
    return yield* await deps.unitOfWork.run<AppError, TransactionPreview>(
      async (repositories) => {
        const prepared = await prepareTransaction(repositories, input, {
          create: false,
        });
        if (prepared.isFailure()) return prepared;

        return success(prepared.value.plan.preview);
      },
    );
  });
