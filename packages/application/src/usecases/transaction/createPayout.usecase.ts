import {
  payoutGross,
  perShareFromGross,
  positionAt,
  withheldFromGross,
} from '@patrimonio/calc';
import { dedupeKey } from '@patrimonio/domain';
import type { DateOnly, PayoutKind, Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { BadRequestError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { TransactionWrite } from '../../interfaces/transaction.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { planTransaction } from '../../plans/transaction.plan.js';
import type { TransactionPreview } from '../../plans/transaction.plan.js';
import { loadPlanContext } from './context.js';
import { portfolioLock } from './createTransaction.usecase.js';
import { findReplay } from './idempotency.js';

export type CreatePayoutInput = {
  readonly portfolio_id: string;
  readonly institution_id: string;
  readonly asset_id: string;
  readonly payout_kind: PayoutKind;
  /** Data-com: é ela que define a quantidade que recebe. */
  readonly record_date: DateOnly;
  readonly payment_date: DateOnly;
  /** O valor por ação. O bruto sai dele vezes a quantidade na data-com. */
  readonly amount_per_share?: string | undefined;
  /** Ou o bruto direto, para o provento que vem como valor total. */
  readonly gross_amount?: string | undefined;
  /** Calculado para JCP quando não vem. */
  readonly tax_withheld?: string | undefined;
  readonly note?: string | undefined;
  readonly confirmed?: boolean | undefined;
  readonly idempotency_key?: string | undefined;
  readonly origin_request_id?: string | undefined;
};

export type PayoutResult = {
  readonly transaction: Transaction;
  /** Nulo no replay: o preview é do estado em que o provento foi criado. */
  readonly preview: TransactionPreview | null;
  readonly queued: EnqueuedEvent | null;
  /** Quantidade na data-com, calculada pelos lançamentos. */
  readonly quantity_at_record_date: string;
  readonly replayed: boolean;
};

export type CreatePayoutDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  /** Alíquota do IR retido no JCP, em percentual. Lei muda; código não precisa. */
  readonly jcpWithholdingPct: string;
};

/** O que o provento calcula, e que o preview e a gravação compartilham. */
export type PreparedPayout = {
  readonly asset_ticker: string;
  readonly quantity: string;
  readonly unit_price: string;
  readonly gross_amount: string;
  readonly tax_withheld: string;
  readonly plan: ReturnType<typeof planTransaction>;
};

/**
 * O caminho comum do preview e da gravação do provento: a quantidade na
 * data-com, o bruto, o IR retido e o plano saem daqui, e por isso os números que
 * o modal mostra são os que ficam gravados.
 */
export const preparePayout = async (
  deps: Pick<CreatePayoutDeps, 'jcpWithholdingPct'>,
  repositories: TransactionalRepositories,
  input: CreatePayoutInput,
): Promise<Either<AppError, PreparedPayout>> => {
  if (input.payment_date < input.record_date) {
    return failure(new BadRequestError('O pagamento não pode ser anterior à data-com'));
  }

  const asset = await repositories.assets.findById(input.asset_id);
  if (asset.isFailure()) return asset;
  if (asset.value === null) {
    return failure(new NotFoundError(`Ativo ${input.asset_id} não encontrado`));
  }

  const context = await loadPlanContext(repositories, {
    portfolio_id: input.portfolio_id,
    asset: {
      id: asset.value.id,
      ticker: asset.value.ticker,
      category_id: asset.value.category_id,
      is_new: false,
    },
    institution_id: input.institution_id,
    ...(input.origin_request_id === undefined
      ? {}
      : { origin_request_id: input.origin_request_id }),
  });
  if (context.isFailure()) return context;

  // A quantidade que recebe é calculada pelos lançamentos na data-com, e
  // não digitada: digitar esse número é a forma mais fácil de o provento
  // ficar errado depois de uma compra esquecida.
  const quantity = positionAt(context.value.asset_entries, input.record_date).quantity;

  if (Number(quantity) <= 0) {
    return failure(
      new BadRequestError(
        `Não havia posição em ${asset.value.ticker} na data-com ${input.record_date}`,
      ),
    );
  }

  const unitPrice =
    input.amount_per_share ?? perShareFromGross(input.gross_amount ?? '0', quantity);

  const gross = payoutGross(quantity, unitPrice);

  // JCP tem IR retido na fonte; dividendo e rendimento de FII, não.
  const tax =
    input.tax_withheld ??
    (input.payout_kind === 'jcp'
      ? withheldFromGross(gross, deps.jcpWithholdingPct)
      : '0');

  const plan = planTransaction(context.value, {
    kind: 'payout',
    trade_date: input.record_date,
    settlement_date: input.payment_date,
    quantity,
    unit_price: unitPrice,
    fees: '0',
    tax_withheld: tax,
    payout_kind: input.payout_kind,
    record_date: input.record_date,
    ...(input.note === undefined ? {} : { note: input.note }),
  });

  return success({
    asset_ticker: asset.value.ticker,
    quantity,
    unit_price: unitPrice,
    gross_amount: gross,
    tax_withheld: tax,
    plan,
  });
};

/**
 * Dividendo, JCP, rendimento, juros e amortização. A quantidade que recebe não
 * é digitada: ela é calculada pelos lançamentos na data-com, porque digitar
 * esse número é a forma mais fácil de o provento ficar errado seis meses depois
 * de uma compra esquecida.
 */
export const createPayout = (deps: CreatePayoutDeps) =>
  either(async function* (input: CreatePayoutInput) {
    return yield* await deps.unitOfWork.run<AppError, PayoutResult>(
      async (repositories) => {
        const replay = await findReplay(repositories, input.idempotency_key);
        if (replay.isFailure()) return replay;

        if (replay.value !== null) {
          return success({
            transaction: replay.value,
            preview: null,
            queued: null,
            replayed: true,
            quantity_at_record_date: replay.value.quantity,
          });
        }

        const prepared = await preparePayout(deps, repositories, input);
        if (prepared.isFailure()) return prepared;

        const {
          quantity,
          unit_price: unitPrice,
          gross_amount: gross,
          tax_withheld: tax,
          plan,
        } = prepared.value;

        /**
         * Provento com pagamento futuro nasce "a receber": ele aparece em
         * Próximos eventos e só vira dinheiro quando o recebimento é
         * confirmado. O que já foi pago pode entrar confirmado de uma vez.
         */
        const confirmed =
          input.confirmed === true ||
          (input.confirmed === undefined && input.payment_date <= deps.clock.today());

        const row: TransactionWrite = {
          kind: 'payout',
          trade_date: input.record_date,
          settlement_date: input.payment_date,
          portfolio_id: input.portfolio_id,
          asset_id: input.asset_id,
          institution_id: input.institution_id,
          quantity,
          unit_price: unitPrice,
          fees: '0',
          gross_amount: gross,
          tax_withheld: tax,
          net_amount: plan.amounts.net_amount,
          payout_kind: input.payout_kind,
          record_date: input.record_date,
          confirmed_at: confirmed ? deps.clock.now().toISOString() : null,
          ...(input.note === undefined ? {} : { note: input.note }),
          ...(input.idempotency_key === undefined
            ? {}
            : { idempotency_key: input.idempotency_key }),
        };

        const inserted = await repositories.transactions.insertMany([row]);
        if (inserted.isFailure()) return inserted;

        const transaction = inserted.value[0];
        if (transaction === undefined) {
          return failure(new BadRequestError('O provento não pôde ser gravado'));
        }

        const events = [
          {
            stage: 'recalc' as const,
            dedupe_key: dedupeKey.recalc(input.portfolio_id),
            payload: {
              portfolio_id: input.portfolio_id,
              from_date: input.record_date,
            },
            ...(input.origin_request_id === undefined
              ? {}
              : { origin_request_id: input.origin_request_id }),
          },
        ];

        const enqueued = await repositories.outbox.enqueue(events);
        if (enqueued.isFailure()) return enqueued;

        return success({
          transaction,
          preview: plan.preview,
          queued: enqueued.value[0] ?? null,
          quantity_at_record_date: quantity,
          replayed: false,
        });
      },
      { lock: portfolioLock(input.portfolio_id) },
    );
  });

export type PreviewPayoutResult = {
  readonly preview: TransactionPreview;
  /** Calculados como a gravação os calcula, para o modal mostrá-los antes. */
  readonly quantity_at_record_date: string;
  readonly unit_price: string;
  readonly gross_amount: string;
  readonly tax_withheld: string;
  readonly net_amount: string;
};

/**
 * O mesmo plano da gravação, sem gravar: a quantidade na data-com, o bruto e o
 * IR retido que o modal mostra são os que `createPayout` vai gravar.
 */
export const previewPayout = (
  deps: Pick<CreatePayoutDeps, 'unitOfWork' | 'jcpWithholdingPct'>,
) =>
  either(async function* (input: CreatePayoutInput) {
    return yield* await deps.unitOfWork.run<AppError, PreviewPayoutResult>(
      async (repositories) => {
        const prepared = await preparePayout(deps, repositories, input);
        if (prepared.isFailure()) return prepared;

        const value = prepared.value;

        return success({
          preview: value.plan.preview,
          quantity_at_record_date: value.quantity,
          unit_price: value.unit_price,
          gross_amount: value.gross_amount,
          tax_withheld: value.tax_withheld,
          net_amount: value.plan.amounts.net_amount,
        });
      },
    );
  });
