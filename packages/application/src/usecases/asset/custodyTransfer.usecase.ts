import { applyLedger } from '@patrimonio/calc';
import type { CustodyTransfer, DateOnly } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { Clock } from '../../interfaces/clock.js';
import type { CustodyTransferRepository } from '../../interfaces/custody_transfer.repository.js';
import type { UnitOfWork } from '../../interfaces/unit-of-work.js';
import { portfolioLock } from '../transaction/createTransaction.usecase.js';

export type TransferCustodyInput = {
  readonly portfolio_id: string;
  readonly asset_id: string;
  readonly to_institution_id: string;
  readonly transfer_date: DateOnly;
  readonly note?: string | null | undefined;
};

export type TransferCustodyResult = {
  readonly transfer: CustodyTransfer;
  readonly from_institution_name: string;
  readonly to_institution_name: string;
};

export type CustodyTransferDeps = {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
};

export type CustodyTransferReadDeps = {
  readonly custodyTransfers: CustodyTransferRepository;
};

/** A quantidade vem como texto decimal (`0.00000000`); posição zerada é tudo zero. */
const isZeroQuantity = (quantity: string): boolean => /^-?0*(\.0*)?$/.test(quantity);

const brazilianDate = (date: DateOnly): string => {
  const [year, month, day] = date.split('-');

  return `${day}/${month}/${year}`;
};

/**
 * Transferir o ativo de uma instituição para outra. A troca não vende nem
 * compra: quantidade, preço médio, caixa e resultado ficam como estão, e por
 * isso nada é recalculado. O que muda é onde o papel está — e o histórico de
 * onde cada compra foi feita continua intacto.
 *
 * Três recusas protegem a ordem dos eventos, que é o que define a custódia
 * atual: ativo sem posição aberta, destino igual à origem e data anterior ao
 * último evento do ativo (que faria a "custódia atual" voltar para trás).
 */
export const transferCustody = (deps: CustodyTransferDeps) =>
  either(async function* (input: TransferCustodyInput) {
    return yield* await deps.unitOfWork.run<AppError, TransferCustodyResult>(
      async (repositories) => {
        const portfolio = await repositories.portfolios.findById(input.portfolio_id);
        if (portfolio.isFailure()) return portfolio;
        if (portfolio.value === null) {
          return failure(
            new NotFoundError(`Carteira ${input.portfolio_id} não encontrada`),
          );
        }

        const asset = await repositories.assets.findById(input.asset_id);
        if (asset.isFailure()) return asset;
        if (asset.value === null) {
          return failure(new NotFoundError(`Ativo ${input.asset_id} não encontrado`));
        }

        const destination = await repositories.institutions.findById(
          input.to_institution_id,
        );
        if (destination.isFailure()) return destination;
        if (destination.value === null) {
          return failure(
            new NotFoundError(`Instituição ${input.to_institution_id} não encontrada`),
          );
        }

        if (input.transfer_date > deps.clock.today()) {
          return failure(new BadRequestError('A data da transferência está no futuro'));
        }

        const current = await repositories.custodyTransfers.currentCustody(
          input.portfolio_id,
          input.asset_id,
        );
        if (current.isFailure()) return current;
        if (current.value === null) {
          return failure(
            new BadRequestError(
              `${asset.value.ticker} não tem lançamento em ${portfolio.value.name}: não há o que transferir`,
            ),
          );
        }

        const entries = await repositories.ledger.entriesForPortfolioAsset(
          input.portfolio_id,
          input.asset_id,
        );
        if (entries.isFailure()) return entries;

        const held = applyLedger(entries.value).position.quantity;
        if (isZeroQuantity(held)) {
          return failure(
            new BadRequestError(
              `${asset.value.ticker} não tem posição aberta em ${portfolio.value.name}: só se transfere o que está custodiado`,
            ),
          );
        }

        if (current.value.institution_id === input.to_institution_id) {
          return failure(
            new BadRequestError(
              `${asset.value.ticker} já está custodiado em ${destination.value.name}`,
            ),
          );
        }

        if (input.transfer_date < current.value.as_of) {
          return failure(
            new BadRequestError(
              `A data não pode ser anterior a ${brazilianDate(current.value.as_of)}, o último lançamento ou transferência deste ativo`,
            ),
          );
        }

        const origin = await repositories.institutions.findById(
          current.value.institution_id,
        );
        if (origin.isFailure()) return origin;

        const created = await repositories.custodyTransfers.create({
          portfolio_id: input.portfolio_id,
          asset_id: input.asset_id,
          from_institution_id: current.value.institution_id,
          to_institution_id: input.to_institution_id,
          transfer_date: input.transfer_date,
          note: input.note === undefined || input.note === '' ? null : input.note,
        });
        if (created.isFailure()) return created;

        return success({
          transfer: created.value,
          from_institution_name: origin.value?.name ?? current.value.institution_id,
          to_institution_name: destination.value.name,
        });
      },
      { lock: portfolioLock(input.portfolio_id) },
    );
  });

export const listCustodyTransfers = (deps: CustodyTransferReadDeps) =>
  either(async function* (portfolioId: string, assetId: string) {
    return yield* await deps.custodyTransfers.listByPortfolioAsset(portfolioId, assetId);
  });

/**
 * Desfazer uma transferência. Só a mais recente do ativo: apagar uma do meio
 * mudaria a origem das seguintes, e o histórico deixaria de fechar.
 */
export const deleteCustodyTransfer = (deps: Pick<CustodyTransferDeps, 'unitOfWork'>) =>
  either(async function* (portfolioId: string, assetId: string, id: string) {
    return yield* await deps.unitOfWork.run<AppError, { readonly removed: boolean }>(
      async (repositories) => {
        const found = await repositories.custodyTransfers.findById(id);
        if (found.isFailure()) return found;
        if (
          found.value === null ||
          found.value.portfolio_id !== portfolioId ||
          found.value.asset_id !== assetId
        ) {
          return failure(new NotFoundError(`Transferência ${id} não encontrada`));
        }

        const all = await repositories.custodyTransfers.listByPortfolioAsset(
          portfolioId,
          assetId,
        );
        if (all.isFailure()) return all;

        if (all.value[0]?.id !== id) {
          return failure(
            new BadRequestError(
              'Só a transferência mais recente pode ser desfeita: desfaça as posteriores primeiro',
            ),
          );
        }

        const removed = await repositories.custodyTransfers.remove(id);
        if (removed.isFailure()) return removed;

        return success({ removed: true });
      },
      { lock: portfolioLock(portfolioId) },
    );
  });
