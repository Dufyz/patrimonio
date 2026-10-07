import { applyLedger } from '@patrimonio/calc';
import { dedupeKey } from '@patrimonio/domain';
import type { CorporateEvent, Transaction } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError, ConflictError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { CorporateEventDraft } from '../../interfaces/corporate_event.repository.js';
import type { CorporateEventRepository } from '../../interfaces/corporate_event.repository.js';
import type { LedgerRow } from '../../interfaces/ledger.repository.js';
import type { EnqueuedEvent } from '../../interfaces/outbox.repository.js';
import type { TransactionWrite } from '../../interfaces/transaction.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';

export type CorporateEventDeps = { readonly corporateEvents: CorporateEventRepository };

export type CorporateEventWriteDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
};

export const listCorporateEvents = (deps: CorporateEventDeps) =>
  either(async function* (filter: {
    readonly pending?: boolean | undefined;
    readonly asset_id?: string | undefined;
  }) {
    return yield* await deps.corporateEvents.list(filter);
  });

/**
 * Registrar um evento não o aplica. Ele fica aguardando confirmação, e é isso
 * que a fila de alertas mostra: um desdobramento aplicado sozinho com data
 * errada reescreve preço médio e resultado de todo o histórico.
 */
export const registerCorporateEvent = (deps: CorporateEventWriteDeps) =>
  either(async function* (draft: CorporateEventDraft) {
    return yield* await deps.unitOfWork.run<AppError, CorporateEvent>(
      async (repositories) => {
        const asset = await repositories.assets.findById(draft.asset_id);
        if (asset.isFailure()) return asset;
        if (asset.value === null) {
          return failure(new NotFoundError(`Ativo ${draft.asset_id} não encontrado`));
        }

        return repositories.corporateEvents.upsert(draft);
      },
    );
  });

export type ConfirmCorporateEventResult = {
  readonly event: CorporateEvent;
  readonly transactions: readonly Transaction[];
  readonly queued: readonly EnqueuedEvent[];
  /** As carteiras que tinham posição na data-com e foram ajustadas. */
  readonly portfolios: readonly string[];
};

/**
 * Confirmar aplica o evento: quantidade e preço médio mudam, o custo total não.
 * O ajuste entra como lançamento em cada carteira que tinha posição na data-com,
 * e o recálculo recomeça dali — de onde a quantidade passou a ser outra.
 *
 * A sobra de um grupamento fica como fração em vez de virar perda de custo: o
 * motor divide a quantidade pela razão, sem arredondar para baixo.
 */
export const confirmCorporateEvent = (deps: CorporateEventWriteDeps) =>
  either(async function* (
    id: string,
    context: { readonly origin_request_id?: string | undefined } = {},
  ) {
    return yield* await deps.unitOfWork.run<AppError, ConfirmCorporateEventResult>(
      async (repositories) => {
        const found = await repositories.corporateEvents.findById(id);
        if (found.isFailure()) return found;
        if (found.value === null) {
          return failure(new NotFoundError(`Evento ${id} não encontrado`));
        }
        if (found.value.confirmed_at !== null) {
          return failure(new ConflictError('Este evento já foi aplicado'));
        }

        const event = found.value;

        const holdings = await repositories.ledger.portfoliosHoldingAsset(event.asset_id);
        if (holdings.isFailure()) return holdings;

        const entries = await repositories.ledger.entriesForAsset(event.asset_id);
        if (entries.isFailure()) return entries;

        const rows: TransactionWrite[] = [];
        const portfolios: string[] = [];

        for (const holding of holdings.value) {
          const ofPortfolio: LedgerRow[] = entries.value.filter(
            (entry) => entry.portfolio_id === holding.portfolio_id,
          );

          const position = applyLedger(ofPortfolio, { until: event.record_date }).position;

          // Carteira sem posição na data-com não é afetada: aplicar o evento
          // nela criaria lançamento que não muda nada e polui o extrato.
          if (Number(position.quantity) <= 0) continue;

          // A instituição do ajuste é a do último lançamento do ativo naquela
          // carteira: o evento acontece onde o papel está custodiado.
          const last = ofPortfolio[ofPortfolio.length - 1];
          if (last === undefined) continue;

          portfolios.push(holding.portfolio_id);
          rows.push({
            kind: 'corporate_event',
            trade_date: event.record_date,
            settlement_date: event.record_date,
            portfolio_id: holding.portfolio_id,
            asset_id: event.asset_id,
            institution_id: last.institution_id,
            quantity: '0',
            unit_price: '0',
            fees: '0',
            gross_amount: '0',
            // Evento corporativo não move dinheiro: muda quantidade e preço médio.
            net_amount: '0',
            event_ratio_from: event.ratio_from,
            event_ratio_to: event.ratio_to,
          });
        }

        if (rows.length === 0) {
          return failure(
            new BadRequestError(
              'Nenhuma carteira tinha posição no ativo na data-com do evento',
            ),
          );
        }

        const inserted = await repositories.transactions.insertMany(rows);
        if (inserted.isFailure()) return inserted;

        const confirmed = await repositories.corporateEvents.confirm(
          id,
          deps.clock.now().toISOString(),
        );
        if (confirmed.isFailure()) return confirmed;
        if (confirmed.value === null) {
          return failure(new ConflictError('Este evento já foi aplicado'));
        }

        const origin =
          context.origin_request_id === undefined
            ? {}
            : { origin_request_id: context.origin_request_id };

        const enqueued = await repositories.outbox.enqueue(
          portfolios.map((portfolioId) => ({
            stage: 'recalc' as const,
            dedupe_key: dedupeKey.recalc(portfolioId),
            payload: { portfolio_id: portfolioId, from_date: event.record_date },
            ...origin,
          })),
        );
        if (enqueued.isFailure()) return enqueued;

        return success({
          event: confirmed.value,
          transactions: inserted.value,
          queued: enqueued.value,
          portfolios,
        });
      },
    );
  });
