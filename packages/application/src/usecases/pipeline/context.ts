import { applyLedger } from '@patrimonio/calc';
import { assetClassFor, indexForIndexer, isIndexer } from '@patrimonio/domain';
import type { Asset, DateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import type { Either } from '@patrimonio/shared';

import { NotFoundError } from '../../errors/app-error.js';
import type { AppError } from '../../errors/app-error.js';
import type { ClassifiedLedgerRow } from '../../interfaces/ledger.repository.js';
import type { PriceAt } from '../../interfaces/price.repository.js';
import type { TransactionalRepositories } from '../../interfaces/unit-of-work.js';
import type {
  CloseAsset,
  CloseEntry,
  FixedIncomeTerms,
  PriceOn,
} from '../../plans/daily_close.plan.js';
import type { RecalculationContext } from '../../plans/recalculation.plan.js';
import type { TaxSale } from '../../plans/taxes.plan.js';

/**
 * O "carregar" da tríade carregar, planejar, aplicar. Tudo o que o recálculo
 * precisa entra aqui numa leitura por tabela, e o plano trabalha em memória a
 * partir disso.
 *
 * A regra que governa este arquivo: nenhuma consulta dentro de laço. Reconstruir
 * dez anos são 2.500 dias; uma consulta por dia, ou pior, por dia e por ativo,
 * não é lentidão — é a diferença entre terminar e não terminar, porque o banco
 * está em outra rede.
 */
const FAR_FUTURE = '9999-12-31';

/** Os termos de marcação na curva, quando o ativo tem algum. */
const fixedIncomeOf = (asset: Asset): FixedIncomeTerms | null => {
  // Preço de mercado vence a curva: Tesouro tem vencimento e indexador, e ainda
  // assim é marcado pela cotação, não pela curva contratada.
  if (asset.origin !== 'manual') return null;
  if (asset.indexer === null || !isIndexer(asset.indexer)) return null;
  if (asset.rate === null || asset.issued_at === null) return null;

  return {
    indexer: asset.indexer,
    rate: asset.rate,
    issued_at: asset.issued_at,
    maturity_date: asset.maturity_date,
  };
};

export const closeAssetOf = (asset: Asset): CloseAsset => ({
  id: asset.id,
  ticker: asset.ticker,
  b3_type: asset.b3_type,
  category_id: asset.category_id,
  // No caixa, o emissor é a própria instituição onde o dinheiro está.
  institution_id: asset.b3_type === 'cash' ? asset.issuer_id : null,
  fixed_income: fixedIncomeOf(asset),
});

const toPriceOn = (price: PriceAt): PriceOn => ({
  price_date: price.price_date,
  close: price.close,
  manual: price.manual,
});

export type LoadRecalculationParams = {
  readonly portfolio_id: string;
  readonly from_date: DateOnly;
  readonly through_date: DateOnly;
  readonly tax_annotations?: RecalculationContext['tax_annotations'];
};

export const loadRecalculationContext = async (
  repositories: TransactionalRepositories,
  params: LoadRecalculationParams,
): Promise<Either<AppError, RecalculationContext | null>> => {
  const portfolio = await repositories.portfolios.findById(params.portfolio_id);
  if (portfolio.isFailure()) return portfolio;
  if (portfolio.value === null) {
    return failure(new NotFoundError(`Carteira ${params.portfolio_id} não encontrada`));
  }

  const entries = await repositories.ledger.entriesForPortfolio(
    params.portfolio_id,
    params.through_date,
  );
  if (entries.isFailure()) return entries;

  // Carteira sem lançamento nenhum não tem projeção a reconstruir, e isso não é
  // erro: é o estado de uma carteira criada hoje.
  if (entries.value.length === 0) return success(null);

  const assets = await repositories.assets.listForPortfolio(params.portfolio_id);
  if (assets.isFailure()) return assets;

  const assetMap = new Map<string, CloseAsset>(
    assets.value.map((asset) => [asset.id, closeAssetOf(asset)]),
  );

  const oldest = entries.value.reduce(
    (earliest, entry) => (entry.trade_date < earliest ? entry.trade_date : earliest),
    params.from_date,
  );

  // O intervalo a reconstruir é de `from_date` para frente; o calendário vai desde
  // o lançamento mais antigo, porque o fator acumulado da curva conta os dias
  // úteis anteriores ao intervalo.
  const calendar = await repositories.businessDays.listBetween(oldest, params.through_date);
  if (calendar.isFailure()) return calendar;

  const businessDays = calendar.value
    .filter((day) => day.is_business_day)
    .map((day) => day.calendar_date);

  const assetIds = [...assetMap.keys()];

  const prices = await repositories.prices.pricesBetween(
    assetIds,
    // O preço vigente no primeiro dia do intervalo pode ser anterior a ele: a
    // leitura começa no lançamento mais antigo para o dia 1 não nascer sem preço.
    oldest,
    params.through_date,
  );
  if (prices.isFailure()) return prices;

  const priceSeries = new Map<string, PriceOn[]>();
  for (const price of prices.value) {
    const bucket = priceSeries.get(price.asset_id) ?? [];
    bucket.push(toPriceOn(price));
    priceSeries.set(price.asset_id, bucket);
  }
  for (const series of priceSeries.values()) {
    series.sort((left, right) =>
      left.price_date < right.price_date ? -1 : left.price_date > right.price_date ? 1 : 0,
    );
  }

  const codes = [
    ...new Set(
      [...assetMap.values()]
        .map((asset) =>
          asset.fixed_income === null ? null : indexForIndexer(asset.fixed_income.indexer),
        )
        .filter((code): code is NonNullable<typeof code> => code !== null),
    ),
  ];

  const quotes =
    codes.length === 0
      ? success([])
      : await repositories.prices.indexFactors(codes, oldest, params.through_date);
  if (quotes.isFailure()) return quotes;

  const indexFactors = new Map<string, Map<DateOnly, string>>();
  for (const quote of quotes.value) {
    const bucket = indexFactors.get(quote.index_code) ?? new Map<DateOnly, string>();
    bucket.set(quote.quote_date, quote.daily_factor);
    indexFactors.set(quote.index_code, bucket);
  }

  const previous = await repositories.projections.lastDayBefore(
    params.portfolio_id,
    params.from_date,
  );
  if (previous.isFailure()) return previous;

  const interval = businessDays.filter(
    (day) => day >= params.from_date && day <= params.through_date,
  );

  return success({
    portfolio_id: params.portfolio_id,
    from_date: params.from_date,
    through_date: params.through_date,
    business_days: interval,
    calendar: businessDays,
    entries: entries.value as readonly CloseEntry[],
    assets: assetMap,
    prices: priceSeries,
    index_factors: indexFactors,
    previous: previous.value,
    ...(params.tax_annotations === undefined
      ? {}
      : { tax_annotations: params.tax_annotations }),
  });
};

/**
 * As vendas de renda variável de **todas** as carteiras, que é o escopo da
 * apuração: o limite de isenção olha a soma das vendas do mês, não da carteira.
 *
 * Renda fixa, Tesouro e caixa ficam de fora: o IR deles é retido na fonte e não
 * entra na apuração mensal.
 */
export const loadTaxSales = async (
  repositories: TransactionalRepositories,
  throughDate: DateOnly,
): Promise<Either<AppError, TaxSale[]>> => {
  const entries = await repositories.ledger.allEntries(throughDate);
  if (entries.isFailure()) return entries;

  const classOf = new Map<string, ReturnType<typeof assetClassFor>>();
  const groups = new Map<string, ClassifiedLedgerRow[]>();

  for (const entry of entries.value) {
    if (entry.asset_id === null) continue;

    const assetClass = assetClassFor(entry.b3_type);
    if (assetClass === null) continue;

    classOf.set(entry.asset_id, assetClass);

    const key = `${entry.portfolio_id}\u0000${entry.asset_id}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }

  const sales: TaxSale[] = [];

  for (const bucket of groups.values()) {
    const assetId = bucket[0]?.asset_id ?? null;
    const assetClass = assetId === null ? null : classOf.get(assetId);
    if (assetClass === null || assetClass === undefined) continue;

    for (const sale of applyLedger(bucket).realized) {
      if (sale.entry_id === null) continue;

      sales.push({
        transaction_id: sale.entry_id,
        trade_date: sale.trade_date,
        asset_class: assetClass,
        proceeds: sale.proceeds,
        result: sale.result,
      });
    }
  }

  // Ordem cronológica: o saldo de prejuízo é uma corrente, e março só reduz a base
  // depois de janeiro ter sido apurado.
  return success(
    sales.sort((left, right) =>
      left.trade_date < right.trade_date ? -1 : left.trade_date > right.trade_date ? 1 : 0,
    ),
  );
};

export { FAR_FUTURE };
