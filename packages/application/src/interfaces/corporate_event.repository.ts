import type { CorporateEvent, CorporateEventKind, DateOnly } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

export type CorporateEventDraft = {
  readonly asset_id: string;
  readonly kind: CorporateEventKind;
  readonly record_date: DateOnly;
  readonly ratio_from: string;
  readonly ratio_to: string;
};

export type CorporateEventRepository = {
  readonly findById: (id: string) => Promise<Either<AppError, CorporateEvent | null>>;

  readonly list: (filter: {
    readonly pending?: boolean | undefined;
    readonly asset_id?: string | undefined;
  }) => Promise<Either<AppError, CorporateEvent[]>>;

  /**
   * O evento anunciado pela fonte entra aqui sem se aplicar. Reanunciar o mesmo
   * evento não cria uma segunda linha: a chave é ativo, tipo e data-com.
   */
  readonly upsert: (
    draft: CorporateEventDraft,
  ) => Promise<Either<AppError, CorporateEvent>>;

  readonly confirm: (
    id: string,
    confirmedAt: string,
  ) => Promise<Either<AppError, CorporateEvent | null>>;
};
