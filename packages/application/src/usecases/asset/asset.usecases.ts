import { applyLedger } from '@patrimonio/calc';
import type { LedgerEntry } from '@patrimonio/calc';
import { classifyAsset, dedupeKey } from '@patrimonio/domain';
import type { Asset, Category, ClassifiableAsset } from '@patrimonio/domain';
import { either, failure, success } from '@patrimonio/shared';

import { BadRequestError, ConflictError, NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type {
  AssetDraft,
  AssetFilter,
  AssetRepository,
  AssetWrite,
} from '../../interfaces/asset.repository.js';
import type { LedgerRow } from '../../interfaces/ledger.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';

export type AssetDeps = { readonly assets: AssetRepository };
export type AssetWriteDeps = { readonly unitOfWork: UnitOfWork };

export const listAssets = (deps: AssetDeps) =>
  either(async function* (filter: AssetFilter) {
    return yield* await deps.assets.list(filter);
  });

export const getAsset = (deps: AssetDeps) =>
  either(async function* (id: string) {
    const asset = yield* await deps.assets.findById(id);

    if (asset === null) {
      return yield* failure(new NotFoundError(`Ativo ${id} não encontrado`));
    }

    return asset;
  });

/**
 * A categoria do ativo é a regra automática, a menos que alguém a sobrescreva:
 * a sobrescrita por ativo fica acima da regra, e é por isso que ela só é
 * aplicada quando o cadastro não traz categoria.
 */
export const classifyWithRules = (
  draft: ClassifiableAsset,
  categories: readonly Category[],
): string | null => classifyAsset(draft, categories)?.id ?? null;

export const createAsset = (deps: AssetWriteDeps) =>
  either(async function* (draft: AssetDraft) {
    return yield* await deps.unitOfWork.run<AppError, Asset>(async (repositories) => {
      const existing = await repositories.assets.findByTicker(draft.ticker);
      if (existing.isFailure()) return existing;
      if (existing.value !== null) {
        return failure(
          new ConflictError(`Já existe um ativo com o código ${draft.ticker}`),
        );
      }

      return createAssetIn(repositories, draft);
    });
  });

/**
 * Compartilhado com o lançamento: ação, FII, ETF, BDR e Tesouro entram no
 * primeiro lançamento que os usa, sem cadastro prévio, e caem na categoria cuja
 * regra automática eles cumprem.
 */
export const createAssetIn = async (
  repositories: TransactionalRepositories,
  draft: AssetDraft,
) => {
  if (draft.category_id === undefined || draft.category_id === null) {
    const categories = await repositories.categories.list();
    if (categories.isFailure()) return categories;

    const classified = classifyWithRules(
      {
        b3_type: draft.b3_type,
        indexer: draft.indexer,
        origin: draft.origin,
        sector: draft.sector,
      },
      categories.value,
    );

    return repositories.assets.create({ ...draft, category_id: classified });
  }

  return repositories.assets.create(draft);
};

/** A posição aberta de um ativo, somada em todas as carteiras. */
const openQuantity = (rows: readonly LedgerRow[]): number => {
  const byPortfolio = new Map<string, LedgerEntry[]>();

  for (const row of rows) {
    const entries = byPortfolio.get(row.portfolio_id) ?? [];
    entries.push(row);
    byPortfolio.set(row.portfolio_id, entries);
  }

  let total = 0;
  for (const entries of byPortfolio.values()) {
    total += Number(applyLedger(entries).position.quantity);
  }

  return total;
};

/**
 * Trocar a categoria de um ativo reclassifica todo o histórico dele: a alocação
 * de toda carteira que o tem muda em todas as datas, e por isso a edição pede
 * recálculo desde o primeiro lançamento de cada uma.
 */
export const updateAsset = (deps: AssetWriteDeps) =>
  either(async function* (
    id: string,
    patch: AssetWrite,
    context: { readonly origin_request_id?: string | undefined } = {},
  ) {
    return yield* await deps.unitOfWork.run<AppError, Asset>(async (repositories) => {
      const current = await repositories.assets.findById(id);
      if (current.isFailure()) return current;
      if (current.value === null) {
        return failure(new NotFoundError(`Ativo ${id} não encontrado`));
      }

      const reclassified =
        patch.category_id !== undefined &&
        patch.category_id !== current.value.category_id;

      const updated = await repositories.assets.update(id, patch);
      if (updated.isFailure()) return updated;
      if (updated.value === null) {
        return failure(new NotFoundError(`Ativo ${id} não encontrado`));
      }

      if (reclassified) {
        const holdings = await repositories.ledger.portfoliosHoldingAsset(id);
        if (holdings.isFailure()) return holdings;

        const events = holdings.value.map((holding) => ({
          stage: 'recalc' as const,
          dedupe_key: dedupeKey.recalc(holding.portfolio_id),
          payload: {
            portfolio_id: holding.portfolio_id,
            from_date: holding.from_date,
          },
          ...(context.origin_request_id === undefined
            ? {}
            : { origin_request_id: context.origin_request_id }),
        }));

        if (events.length > 0) {
          const enqueued = await repositories.outbox.enqueue(events);
          if (enqueued.isFailure()) return enqueued;
        }
      }

      return success(updated.value);
    });
  });

/** Arquivar esconde o ativo das buscas e do cadastro, mantendo o histórico. */
export const archiveAsset = (deps: AssetWriteDeps) =>
  either(async function* (id: string, archived: boolean) {
    return yield* await deps.unitOfWork.run<AppError, Asset>(async (repositories) => {
      const found = await repositories.assets.findById(id);
      if (found.isFailure()) return found;
      if (found.value === null) {
        return failure(new NotFoundError(`Ativo ${id} não encontrado`));
      }

      if (archived) {
        const rows = await repositories.ledger.entriesForAsset(id);
        if (rows.isFailure()) return rows;

        // Só é possível arquivar depois que a posição foi zerada: um ativo
        // arquivado com posição aberta sumiria da busca e continuaria valendo
        // dinheiro na tela.
        if (openQuantity(rows.value) !== 0) {
          return failure(
            new ConflictError(
              'O ativo ainda tem posição aberta: arquivar só é possível com a posição zerada',
            ),
          );
        }
      }

      const updated = await repositories.assets.setArchived(id, archived);
      if (updated.isFailure()) return updated;
      if (updated.value === null) {
        return failure(new NotFoundError(`Ativo ${id} não encontrado`));
      }

      return success(updated.value);
    });
  });

/**
 * Excluir é bloqueado quando há lançamento: apagar o cadastro apagaria o
 * histórico junto e mudaria a rentabilidade passada. A mensagem traz a contagem,
 * e o caminho oferecido é arquivar.
 */
export const deleteAsset = (deps: AssetWriteDeps) =>
  either(async function* (id: string) {
    return yield* await deps.unitOfWork.run<AppError, { readonly id: string }>(
      async (repositories) => {
        const found = await repositories.assets.findById(id);
        if (found.isFailure()) return found;
        if (found.value === null) {
          return failure(new NotFoundError(`Ativo ${id} não encontrado`));
        }

        const usage = await repositories.assets.usage(id);
        if (usage.isFailure()) return usage;

        if (usage.value.transactions > 0) {
          return failure(
            new ConflictError(
              `O ativo tem ${usage.value.transactions} lançamento(s) em ` +
                `${usage.value.portfolios} carteira(s). Excluí-lo apagaria esse ` +
                'histórico: arquive o ativo depois de zerar a posição',
            ),
          );
        }

        const removed = await repositories.assets.remove(id);
        if (removed.isFailure()) return removed;
        if (!removed.value) {
          return failure(new BadRequestError('O ativo não pôde ser excluído'));
        }

        return success({ id });
      },
    );
  });
