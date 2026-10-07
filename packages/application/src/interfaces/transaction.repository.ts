import type {
  DateOnly,
  PayoutKind,
  Transaction,
  TransactionKind,
} from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * A linha como ela vai para o banco. Valor bruto e líquido não são aceitos da
 * tela: eles são calculados pelo plano, porque um número digitado em um lugar e
 * recalculado em outro diverge mais cedo do que se imagina.
 */
export type TransactionWrite = {
  readonly id?: string | undefined;
  readonly kind: TransactionKind;
  readonly trade_date: DateOnly;
  readonly settlement_date: DateOnly;
  readonly portfolio_id: string;
  readonly asset_id?: string | null | undefined;
  readonly institution_id: string;
  readonly quantity: string;
  readonly unit_price: string;
  readonly fees: string;
  readonly gross_amount: string;
  readonly tax_withheld?: string | undefined;
  readonly net_amount: string;
  readonly payout_kind?: PayoutKind | null | undefined;
  readonly record_date?: DateOnly | null | undefined;
  readonly confirmed_at?: string | null | undefined;
  readonly transfer_group_id?: string | null | undefined;
  readonly event_ratio_from?: string | null | undefined;
  readonly event_ratio_to?: string | null | undefined;
  readonly note?: string | null | undefined;
  readonly idempotency_key?: string | null | undefined;
};

export type TransactionPatch = Partial<Omit<TransactionWrite, 'id'>>;

export type TransactionFilter = {
  readonly portfolio_id?: string | undefined;
  readonly asset_id?: string | undefined;
  readonly institution_id?: string | undefined;
  readonly kind?: TransactionKind | undefined;
  readonly from?: DateOnly | undefined;
  readonly to?: DateOnly | undefined;
  readonly pending_payouts?: boolean | undefined;
  readonly page: number;
  readonly limit: number;
};

export type TransactionPage = {
  readonly data: readonly Transaction[];
  readonly total: number;
};

export type TransactionRepository = {
  /**
   * Um identificador novo. Gerar id é infraestrutura — UUID v7, crescente no
   * tempo —, e o caso de uso precisa dele para ligar as duas pernas de uma
   * transferência antes de gravá-las.
   */
  readonly nextId: () => string;

  readonly findById: (id: string) => Promise<Either<AppError, Transaction | null>>;

  /**
   * A mesma `Idempotency-Key` duas vezes devolve o mesmo lançamento. É o que
   * transforma clique duplo em conflito tratado, e não em segundo lançamento.
   */
  readonly findByIdempotencyKey: (
    key: string,
  ) => Promise<Either<AppError, Transaction | null>>;

  readonly list: (
    filter: TransactionFilter,
  ) => Promise<Either<AppError, TransactionPage>>;

  /** Uma consulta para N linhas: as duas pernas de uma transferência entram juntas. */
  readonly insertMany: (
    rows: readonly TransactionWrite[],
  ) => Promise<Either<AppError, Transaction[]>>;

  readonly update: (
    id: string,
    patch: TransactionPatch,
  ) => Promise<Either<AppError, Transaction | null>>;

  readonly remove: (id: string) => Promise<Either<AppError, Transaction | null>>;

  /** As duas pernas de uma transferência saem ou ficam juntas. */
  readonly removeByTransferGroup: (
    groupId: string,
  ) => Promise<Either<AppError, Transaction[]>>;

  readonly findByTransferGroup: (
    groupId: string,
  ) => Promise<Either<AppError, Transaction[]>>;
};
