import type { Transaction } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { TransactionalRepositories } from '../../interfaces/unit-of-work.js';
import type { PlanContext } from '../../plans/transaction.plan.js';

/** O livro inteiro: sem data de corte, porque editar o passado é comum. */
const FAR_FUTURE = '9999-12-31';

/**
 * O ativo do lançamento, já resolvido. No preview de um ticker que ainda não
 * existe, ele é hipotético: tem id de rascunho, nenhum lançamento anterior e a
 * categoria que a regra automática daria.
 */
export type ContextAsset = {
  readonly id: string;
  readonly ticker: string;
  readonly category_id: string | null;
  readonly is_new: boolean;
};

export type ContextParams = {
  readonly portfolio_id: string;
  readonly asset: ContextAsset | null;
  readonly institution_id: string;
  /** Numa edição, o lançamento que sai da sequência antes de o novo entrar. */
  readonly replacing?: Transaction | undefined;
  readonly origin_request_id?: string | undefined;
};

/**
 * O "carregar" da tríade carregar, planejar, aplicar: uma leitura do livro da
 * carteira, e o plano trabalha em memória a partir dela. Ler o livro inteiro é
 * o que mantém o número certo enquanto `position_daily` não existe — e é por
 * isso que o plano não faz I/O nenhum.
 */
export const loadPlanContext = async (
  repositories: TransactionalRepositories,
  params: ContextParams,
): Promise<Either<AppError, PlanContext>> => {
  const portfolio = await repositories.portfolios.findById(params.portfolio_id);
  if (portfolio.isFailure()) return portfolio;
  if (portfolio.value === null) {
    return failure(new NotFoundError(`Carteira ${params.portfolio_id} não encontrada`));
  }

  const entries = await repositories.ledger.entriesForPortfolio(
    params.portfolio_id,
    FAR_FUTURE,
  );
  if (entries.isFailure()) return entries;

  const categories = await repositories.ledger.assetCategories(params.portfolio_id);
  if (categories.isFailure()) return categories;

  const targets = await repositories.portfolios.listTargets(params.portfolio_id);
  if (targets.isFailure()) return targets;

  const asset = params.asset;

  const categoryName = await (async (): Promise<string | null> => {
    if (asset === null || asset.category_id === null) return null;

    const category = await repositories.categories.findById(asset.category_id);
    return category.isSuccess() && category.value !== null ? category.value.name : null;
  })();

  const categoryByAsset = new Map(categories.value);
  if (asset !== null) categoryByAsset.set(asset.id, asset.category_id);

  const context: PlanContext = {
    portfolio_id: params.portfolio_id,
    asset,
    institution_id: params.institution_id,
    asset_entries:
      asset === null ? [] : entries.value.filter((row) => row.asset_id === asset.id),
    institution_entries: entries.value.filter(
      (row) => row.institution_id === params.institution_id,
    ),
    portfolio_entries: entries.value,
    category_by_asset: categoryByAsset,
    targets: new Map(
      targets.value.map((target) => [target.category_id, target.target_pct]),
    ),
    category_name: categoryName,
    ...(params.replacing === undefined
      ? {}
      : {
          replacing: {
            id: params.replacing.id,
            kind: params.replacing.kind,
            trade_date: params.replacing.trade_date,
            quantity: params.replacing.quantity,
            unit_price: params.replacing.unit_price,
            fees: params.replacing.fees,
            net_amount: params.replacing.net_amount,
            payout_kind: params.replacing.payout_kind,
            event_ratio_from: params.replacing.event_ratio_from,
            event_ratio_to: params.replacing.event_ratio_to,
          },
        }),
    ...(params.origin_request_id === undefined
      ? {}
      : { origin_request_id: params.origin_request_id }),
  };

  return success(context);
};
