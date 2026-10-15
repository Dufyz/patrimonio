import {
  describeFixedIncome,
  fixedIncomeCategoryId,
  fixedIncomeTicker,
} from '@patrimonio/domain';
import type {
  Asset,
  DateOnly,
  Indexer,
  LiquidityKind,
  RedemptionRule,
  TaxRegime,
} from '@patrimonio/domain';
import { either, failure } from '@patrimonio/shared';

import { BadRequestError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { AssetDraft } from '../../interfaces/asset.repository.js';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../interfaces/unit-of-work.js';
import { createAssetIn } from './asset.usecases.js';

/**
 * CDB, LCI, LCA, CRI, CRA e debênture não têm cotação pública: o preço é
 * marcado na curva pela taxa, e por isso emissor, indexador, taxa, datas,
 * liquidez e regime de IR são obrigatórios. Sem eles o título existe no cadastro
 * e não tem valor em nenhuma data.
 */
export type FixedIncomeKind =
  'cdb' | 'lci' | 'lca' | 'cri' | 'cra' | 'debenture' | 'outro';

export type CreateFixedIncomeInput = {
  readonly kind: FixedIncomeKind;
  readonly issuer_id: string;
  readonly indexer: Indexer;
  readonly rate: string;
  readonly issued_at: DateOnly;
  /** Obrigatório, exceto na caixinha: ela não tem vencimento próprio. */
  readonly maturity_date?: DateOnly | undefined;
  /**
   * Presente só na caixinha: o ativo passa a ter lotes, um por aplicação, e a
   * regra diz qual deles o resgate consome primeiro.
   */
  readonly redemption_rule?: RedemptionRule | undefined;
  /**
   * Caixinha cujos lotes vencem cada um no seu: prazo padrão do aporte, em meses.
   * Exclusivo com `maturity_date`, que é a caixinha inteira vencendo.
   */
  readonly lot_term_months?: number | undefined;
  readonly liquidity: LiquidityKind;
  readonly liquidity_days?: number | undefined;
  readonly tax_regime: TaxRegime;
  /** Gerado quando não vem, e editável depois. */
  readonly name?: string | undefined;
  /** Ausente é a categoria do tipo do título. */
  readonly category_id?: string | null | undefined;
};

export type CreateFixedIncomeDeps = { readonly unitOfWork: UnitOfWork };

/** Títulos isentos de IR não aplicam a tabela regressiva; o resto aplica. */
const EXEMPT_BY_NATURE: ReadonlySet<FixedIncomeKind> = new Set<FixedIncomeKind>([
  'lci',
  'lca',
  'cri',
  'cra',
]);

/**
 * O código interno precisa ser único, e dois CDBs do mesmo banco com o mesmo
 * vencimento acontecem — taxas diferentes, aplicações diferentes. O sufixo
 * numérico resolve sem pedir nada ao usuário.
 */
const uniqueTicker = async (
  repositories: TransactionalRepositories,
  base: string,
): Promise<string | AppError> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await repositories.assets.findByTicker(candidate);

    if (existing.isFailure()) return existing.value;
    if (existing.value === null) return candidate;
  }

  return new BadRequestError(
    'Não foi possível gerar um código único para o título: informe um nome diferente',
  );
};

const rateLabel = (indexer: Indexer, rate: string): string => {
  const value = String(Number(rate));

  switch (indexer) {
    case 'cdi_pct':
      return `${value}% CDI`;
    case 'ipca_plus':
      return `IPCA + ${value}%`;
    case 'selic_plus':
      return `Selic + ${value}%`;
    case 'prefixed':
      return `${value}% a.a.`;
  }
};

export const createFixedIncomeAsset = (deps: CreateFixedIncomeDeps) =>
  either(async function* (input: CreateFixedIncomeInput) {
    return yield* await deps.unitOfWork.run<AppError, Asset>(async (repositories) => {
      if (input.liquidity === 'd_plus_n' && input.liquidity_days === undefined) {
        return failure(
          new BadRequestError('Liquidez D+n precisa do número de dias para liquidar'),
        );
      }

      const caixinha = input.redemption_rule !== undefined;

      if (!caixinha && input.maturity_date === undefined) {
        return failure(new BadRequestError('Informe o vencimento do título'));
      }

      if (!caixinha && input.lot_term_months !== undefined) {
        return failure(new BadRequestError('Prazo por lote só existe na caixinha'));
      }

      if (
        caixinha &&
        input.maturity_date !== undefined &&
        input.lot_term_months !== undefined
      ) {
        return failure(
          new BadRequestError(
            'Escolha: a caixinha vence como um todo, ou cada lote vence no seu prazo',
          ),
        );
      }

      if (
        caixinha &&
        input.liquidity === 'at_maturity' &&
        input.maturity_date === undefined &&
        input.lot_term_months === undefined
      ) {
        return failure(
          new BadRequestError(
            'Liquidez no vencimento precisa de um vencimento: da caixinha ou de cada lote',
          ),
        );
      }

      if (input.maturity_date !== undefined && input.maturity_date < input.issued_at) {
        return failure(
          new BadRequestError('O vencimento não pode ser anterior à aplicação'),
        );
      }

      const issuer = await repositories.institutions.findById(input.issuer_id);
      if (issuer.isFailure()) return issuer;
      if (issuer.value === null) {
        return failure(new BadRequestError('O emissor informado não existe'));
      }

      if (EXEMPT_BY_NATURE.has(input.kind) && input.tax_regime !== 'exempt') {
        return failure(
          new BadRequestError(
            `${input.kind.toUpperCase()} é isento de IR: o regime não pode ser a tabela regressiva`,
          ),
        );
      }

      const base = fixedIncomeTicker({
        kind: input.kind,
        issuer_name: issuer.value.name,
        maturity_date: input.maturity_date ?? null,
        ...(caixinha ? { suffix: 'CAIXINHA' } : {}),
      });

      const ticker = await uniqueTicker(repositories, base);
      if (typeof ticker !== 'string') return failure(ticker);

      // O tipo do título define a categoria do catálogo; sem o catálogo carregado,
      // o ativo fica sem categoria em vez de apontar para uma linha que não existe.
      const category = await repositories.categories.findById(
        input.category_id ?? fixedIncomeCategoryId(input.kind),
      );
      if (category.isFailure()) return category;

      const draft: AssetDraft = {
        ticker,
        name:
          input.name ??
          (caixinha
            ? `Caixinha ${issuer.value.name} · ${rateLabel(input.indexer, input.rate)}`
            : describeFixedIncome({
                kind: input.kind,
                issuer_name: issuer.value.name,
                maturity_date: input.maturity_date ?? null,
                indexer: input.indexer,
                rate: input.rate,
              })),
        origin: 'manual',
        // Título bancário não tem tipo de B3: ele não é negociado em pregão.
        b3_type: null,
        category_id: category.value?.id ?? null,
        issuer_id: input.issuer_id,
        // O preço vem da curva, não de provedor: a fonte automática não tem o
        // que buscar para este papel.
        price_source: 'manual',
        indexer: input.indexer,
        rate: input.rate,
        issued_at: input.issued_at,
        maturity_date: input.maturity_date ?? null,
        liquidity: input.liquidity,
        liquidity_days: input.liquidity_days ?? null,
        tax_regime: input.tax_regime,
        redemption_rule: input.redemption_rule ?? null,
        lot_term_months: input.lot_term_months ?? null,
      };

      return createAssetIn(repositories, draft);
    });
  });
