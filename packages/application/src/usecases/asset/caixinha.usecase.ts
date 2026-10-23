import { curveValue, lotsFromLedger, planRedemption, valueLots } from '@patrimonio/calc';
import type {
  Lot,
  LotsValuation,
  RedemptionPlan,
  RedemptionRule,
} from '@patrimonio/calc';
import { indexForIndexer } from '@patrimonio/domain';
import type { Asset, DateOnly, Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { BadRequestError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import type { TransactionPreview } from '../../plans/transaction.plan.js';
import { findReplay } from '../transaction/idempotency.js';
import {
  portfolioLock,
  prepareTransaction,
} from '../transaction/createTransaction.usecase.js';

/**
 * A caixinha é um ativo com lotes: cada aplicação é um lote, e o resgate consome
 * lotes pela regra do ativo. Os lotes não são gravados — saem do livro, que
 * continua sendo a única fonte da verdade —, então este módulo os reconstrói,
 * valoriza cada um na curva da própria data e planeja o resgate sobre eles.
 *
 * No livro a quantidade é o principal (uma unidade vale R$ 1,00 aplicado) e o
 * resgate grava o principal consumido, o bruto por unidade como preço e o IR como
 * taxa. É isso que mantém o custo e o resultado realizado corretos no motor de
 * preço médio sem ele saber de lote nenhum.
 */
export type CaixinhaDeps = { readonly unitOfWork: UnitOfWork };

export type CaixinhaState = {
  readonly asset: Asset;
  readonly rule: RedemptionRule;
  readonly lots: readonly Lot[];
  readonly factors: ReadonlyMap<string, string>;
  /** Algum dia útil sem índice publicado: o valor é o melhor disponível. */
  readonly incomplete: boolean;
};

/**
 * Os lotes da caixinha numa carteira em uma data, e o fator da curva de cada um.
 * Uma leitura do livro e uma da série do índice: nenhuma consulta por lote.
 */
export const loadCaixinha = async (
  repositories: TransactionalRepositories,
  params: {
    readonly portfolio_id: string;
    readonly asset_id: string;
    readonly as_of: DateOnly;
  },
): Promise<Either<AppError, CaixinhaState>> => {
  const asset = await repositories.assets.findById(params.asset_id);
  if (asset.isFailure()) return asset;
  if (asset.value === null) {
    return failure(new NotFoundError(`Ativo ${params.asset_id} não encontrado`));
  }

  const rule = asset.value.redemption_rule;
  if (rule === null || asset.value.indexer === null || asset.value.rate === null) {
    return failure(new BadRequestError('O ativo não é uma caixinha'));
  }

  const entries = await repositories.ledger.entriesForPortfolioAsset(
    params.portfolio_id,
    params.asset_id,
  );
  if (entries.isFailure()) return entries;

  const lots = lotsFromLedger(
    entries.value.filter((entry) => entry.trade_date <= params.as_of),
    rule,
    {
      default_maturity: asset.value.maturity_date,
      default_term_months: asset.value.lot_term_months,
      matured_only: asset.value.liquidity === 'at_maturity',
    },
  );

  const oldest = lots[0]?.trade_date ?? params.as_of;

  const calendar = await repositories.businessDays.listBetween(oldest, params.as_of);
  if (calendar.isFailure()) return calendar;

  const businessDays = calendar.value
    .filter((day) => day.is_business_day)
    .map((day) => day.calendar_date);

  const code = indexForIndexer(asset.value.indexer);
  const quotes =
    code === null
      ? success([])
      : await repositories.prices.indexFactors([code], oldest, params.as_of);
  if (quotes.isFailure()) return quotes;

  const indexFactors = quotes.value.map((quote) => ({
    date: quote.quote_date,
    daily_factor: quote.daily_factor,
  }));

  const factors = new Map<string, string>();
  let incomplete = false;

  for (const lot of lots) {
    if (Number(lot.remaining) <= 0) continue;

    const curve = curveValue({
      principal: '1',
      issued_at: lot.trade_date,
      // O lote vencido para de render: a curva congela no vencimento dele.
      reference_date:
        lot.maturity_date !== null && lot.maturity_date < params.as_of
          ? lot.maturity_date
          : params.as_of,
      indexer: asset.value.indexer,
      rate: asset.value.rate,
      business_days: businessDays,
      index_factors: indexFactors,
    });

    if (curve.missing_days.length > 0) incomplete = true;
    factors.set(lot.id, curve.factor);
  }

  return success({ asset: asset.value, rule, lots, factors, incomplete });
};

export const valueCaixinha = (state: CaixinhaState, asOf: DateOnly): LotsValuation =>
  valueLots({
    lots: state.lots,
    factors: state.factors,
    reference_date: asOf,
    tax_regime: state.asset.tax_regime ?? 'regressive',
    matured_only: state.asset.liquidity === 'at_maturity',
  });

export type CaixinhaView = {
  readonly as_of: DateOnly;
  readonly rule: RedemptionRule;
  readonly valuation: LotsValuation;
  readonly incomplete: boolean;
};

/** Os lotes da caixinha numa data, com valor e IR de cada um. */
export const getCaixinha = (deps: CaixinhaDeps & { readonly clock: Clock }) =>
  either(async function* (input: {
    readonly portfolio_id: string;
    readonly asset_id: string;
    readonly as_of?: DateOnly | undefined;
  }) {
    return yield* await deps.unitOfWork.run<AppError, CaixinhaView>(
      async (repositories) => {
        const asOf = input.as_of ?? deps.clock.today();

        const state = await loadCaixinha(repositories, {
          portfolio_id: input.portfolio_id,
          asset_id: input.asset_id,
          as_of: asOf,
        });
        if (state.isFailure()) return state;

        return success({
          as_of: asOf,
          rule: state.value.rule,
          valuation: valueCaixinha(state.value, asOf),
          incomplete: state.value.incomplete,
        });
      },
    );
  });

export type CaixinhaRedemptionInput = {
  readonly portfolio_id: string;
  readonly asset_id: string;
  readonly trade_date: DateOnly;
  /** Valor bruto a resgatar, antes do IR. */
  readonly amount: string;
  readonly idempotency_key?: string | undefined;
};

export type CaixinhaRedemptionPreview = {
  /** A instituição da caixinha: o emissor do ativo. */
  readonly institution_id: string;
  readonly rule: RedemptionRule;
  readonly plan: RedemptionPlan;
  readonly incomplete: boolean;
};

const planFor = async (
  repositories: TransactionalRepositories,
  input: CaixinhaRedemptionInput,
): Promise<Either<AppError, CaixinhaRedemptionPreview>> => {
  const state = await loadCaixinha(repositories, {
    portfolio_id: input.portfolio_id,
    asset_id: input.asset_id,
    as_of: input.trade_date,
  });
  if (state.isFailure()) return state;

  const plan = planRedemption({
    lots: state.value.lots,
    amount: input.amount,
    rule: state.value.rule,
    redemption_date: input.trade_date,
    factors: state.value.factors,
    tax_regime: state.value.asset.tax_regime ?? 'regressive',
    matured_only: state.value.asset.liquidity === 'at_maturity',
  });

  const institution = state.value.asset.issuer_id;
  if (institution === null) {
    return failure(new BadRequestError('A caixinha não tem instituição'));
  }

  return success({
    institution_id: institution,
    rule: state.value.rule,
    plan,
    incomplete: state.value.incomplete,
  });
};

/** Quais lotes um resgate consome e quanto cai na conta, sem gravar nada. */
export const previewCaixinhaRedemption = (deps: CaixinhaDeps) =>
  either(async function* (input: CaixinhaRedemptionInput) {
    return yield* await deps.unitOfWork.run<AppError, CaixinhaRedemptionPreview>(
      async (repositories) => planFor(repositories, input),
    );
  });

export type CaixinhaRedemptionResult = {
  readonly transaction: Transaction;
  readonly preview: TransactionPreview | null;
  readonly queued: EnqueuedEvent | null;
  readonly replayed: boolean;
  readonly redemption: CaixinhaRedemptionPreview | null;
};

/**
 * Grava o resgate como uma venda do ativo: o principal consumido como quantidade,
 * o bruto por unidade como preço e o IR como taxa. A venda passa pelo mesmo
 * plano de qualquer lançamento — preview, posição e evento de recálculo.
 */
export const redeemCaixinha = (deps: CaixinhaDeps) =>
  either(async function* (input: CaixinhaRedemptionInput) {
    return yield* await deps.unitOfWork.run<AppError, CaixinhaRedemptionResult>(
      async (repositories) => {
        const replay = await findReplay(repositories, input.idempotency_key);
        if (replay.isFailure()) return replay;

        if (replay.value !== null) {
          return success({
            transaction: replay.value,
            preview: null,
            queued: null,
            replayed: true,
            redemption: null,
          });
        }

        const redemption = await planFor(repositories, input);
        if (redemption.isFailure()) return redemption;

        const { plan } = redemption.value;

        const institutionId = redemption.value.institution_id;

        if (plan.insufficient) {
          return failure(
            new BadRequestError(
              `A caixinha tem ${plan.available_gross} disponíveis em ${input.trade_date}: ` +
                `não dá para resgatar ${input.amount}`,
            ),
          );
        }

        const prepared = await prepareTransaction(
          repositories,
          {
            kind: 'sell',
            portfolio_id: input.portfolio_id,
            // A caixinha pertence a uma instituição, e toda operação é nela.
            institution_id: institutionId,
            asset_id: input.asset_id,
            trade_date: input.trade_date,
            // O resgate cai na conta no mesmo dia; só o aporte espera liquidar.
            settlement_date: input.trade_date,
            quantity: plan.principal,
            unit_price: plan.unit_price,
            fees: plan.tax_due,
            ...(input.idempotency_key === undefined
              ? {}
              : { idempotency_key: input.idempotency_key }),
          },
          { caixinhaRedemption: true },
        );
        if (prepared.isFailure()) return prepared;

        const inserted = await repositories.transactions.insertMany([prepared.value.row]);
        if (inserted.isFailure()) return inserted;

        const transaction = inserted.value[0];
        if (transaction === undefined) {
          return failure(new BadRequestError('O resgate não pôde ser gravado'));
        }

        const enqueued = await repositories.outbox.enqueue(prepared.value.plan.events);
        if (enqueued.isFailure()) return enqueued;

        return success({
          transaction,
          preview: prepared.value.plan.preview,
          queued: enqueued.value[0] ?? null,
          replayed: false,
          redemption: redemption.value,
        });
      },
      { lock: portfolioLock(input.portfolio_id) },
    );
  });
