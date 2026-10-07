import { applyLedger, buildQuotaSeries, cashBalance, curveValue } from '@patrimonio/calc';
import type { CurveIndexer, CurveValue, LedgerEntry } from '@patrimonio/calc';
import type { B3Type, ComputedPriceKind, DateOnly } from '@patrimonio/domain';
import { Decimal } from 'decimal.js';

import type {
  PortfolioDailyWrite,
  PositionDailyWrite,
} from '../interfaces/projection.repository.js';

/**
 * O fechamento do dia transforma o livro em projeção: uma linha por ativo com
 * posição aberta e uma linha por carteira. Gravar todo ativo todos os dias, mesmo
 * sem movimento, é deliberado — guardar só os dias com movimento tornaria cada
 * tela um `LATERAL JOIN` buscando o último valor anterior, que é exatamente o que
 * fica lento e difícil de testar.
 *
 * O plano é função pura: o contexto entra carregado, e nada aqui faz I/O nem chama
 * `new Date()`.
 */
const MONEY_DP = 2;
const QUANTITY_DP = 8;
const PRICE_DP = 8;

const zero = new Decimal(0);

const money = (value: Decimal): string =>
  value.toDecimalPlaces(MONEY_DP).toFixed(MONEY_DP);

export type CloseEntry = LedgerEntry & {
  readonly asset_id: string | null;
  readonly institution_id: string;
};

export type FixedIncomeTerms = {
  readonly indexer: CurveIndexer;
  readonly rate: string;
  readonly issued_at: DateOnly;
  readonly maturity_date: DateOnly | null;
};

export type CloseAsset = {
  readonly id: string;
  readonly ticker: string;
  readonly b3_type: B3Type | null;
  readonly category_id: string | null;
  /**
   * Só no caixa: a instituição cujo saldo essa posição representa. A posição de
   * caixa não é a soma das quantidades lançadas nele — é a soma dos valores
   * líquidos da carteira naquela instituição, porque comprar tira e vender põe.
   */
  readonly institution_id: string | null;
  /** Só em título marcado na curva. Tesouro e ação têm preço e não entram aqui. */
  readonly fixed_income: FixedIncomeTerms | null;
};

export type PriceOn = {
  readonly price_date: DateOnly;
  readonly close: string;
  readonly manual: boolean;
};

/**
 * O que a série de cota precisa do dia anterior. `PortfolioDaily` satisfaz este
 * tipo, e o plano do dia seguinte também — é o que permite encadear os dias de um
 * recálculo sem passar pelo banco entre eles.
 */
export type CloseSeed = {
  readonly position_date: DateOnly;
  readonly total_value: string;
  readonly quota_value: string;
  readonly quota_count: string;
  readonly cumulative_contributions: string;
};

export type DailyCloseContext = {
  readonly portfolio_id: string;
  readonly reference_date: DateOnly;
  /** O livro da carteira até a data de referência, inclusive. */
  readonly entries: readonly CloseEntry[];
  readonly assets: ReadonlyMap<string, CloseAsset>;
  /** O preço mais recente em ou antes da data, por ativo. */
  readonly prices: ReadonlyMap<string, PriceOn>;
  /** O fator da curva na data, por ativo de renda fixa. */
  readonly curves: ReadonlyMap<string, CurveValue>;
  /** A linha do dia anterior da série. Nula no primeiro dia da carteira. */
  readonly previous: CloseSeed | null;
};

export type PriceHealth = {
  readonly fresh: number;
  readonly stale: number;
  readonly manual: number;
  readonly missing: number;
};

export type DailyClosePlan = {
  readonly positions: readonly PositionDailyWrite[];
  readonly portfolio: PortfolioDailyWrite;
  readonly health: PriceHealth;
  /** Ativos cujo valor entrou pelo custo por não haver preço nenhum. */
  readonly priced_at_cost: readonly string[];
};

const isCash = (asset: CloseAsset | undefined): boolean => asset?.b3_type === 'cash';

type Valued = {
  readonly market_value: Decimal;
  readonly kind: ComputedPriceKind;
  readonly accrued: Decimal;
};

/**
 * O valor de uma posição e a confiança que ele merece. A ordem é deliberada:
 * caixa vale o saldo, título marcado na curva vale a curva, o resto vale a
 * cotação — e quando não há cotação nenhuma, vale o custo, marcado.
 */
const valuePosition = (
  asset: CloseAsset | undefined,
  quantity: Decimal,
  costBasis: Decimal,
  price: PriceOn | undefined,
  curve: CurveValue | undefined,
  referenceDate: DateOnly,
): Valued => {
  // Caixa não tem cotação: o valor dele é o próprio saldo, e isso nunca é
  // "preço atrasado".
  if (isCash(asset)) {
    return { market_value: quantity, kind: 'fresh', accrued: zero };
  }

  const fixedIncome = asset?.fixed_income ?? null;

  if (fixedIncome !== null) {
    if (curve === undefined) {
      return { market_value: costBasis, kind: 'missing', accrued: zero };
    }

    // A curva entra como **fator**, não como valor: assim um resgate parcial, que
    // reduz o custo proporcionalmente, reduz o valor na curva junto, sem o motor
    // precisar refazer a conta com outro principal.
    const value = costBasis.times(new Decimal(curve.factor));

    // Buraco na série do indexador não impede marcar, mas a linha deixa de ser
    // confiável como fechamento do dia: ela é marcada.
    const kind: ComputedPriceKind = curve.missing_days.length > 0 ? 'stale' : 'fresh';

    return { market_value: value, kind, accrued: value.minus(costBasis) };
  }

  if (price === undefined) {
    // Nenhuma fonte tem preço: o total da carteira nunca vai a zero por falta de
    // preço, e a ressalva fica visível na linha.
    return { market_value: costBasis, kind: 'missing', accrued: zero };
  }

  const value = quantity.times(new Decimal(price.close));

  if (price.manual) return { market_value: value, kind: 'manual', accrued: zero };

  return {
    market_value: value,
    kind: price.price_date === referenceDate ? 'fresh' : 'stale',
    accrued: zero,
  };
};

/** Dinheiro que cruzou a fronteira do patrimônio no dia. */
const flowOn = (entries: readonly CloseEntry[], date: DateOnly): Decimal =>
  entries
    .filter(
      (entry) =>
        entry.trade_date === date &&
        (entry.kind === 'deposit' || entry.kind === 'withdrawal'),
    )
    .reduce((total, entry) => total.plus(new Decimal(entry.net_amount)), zero);

/**
 * Quanto do rendimento do dia veio de provento. Amortização fica fora: ela devolve
 * principal e reduz o custo, e contá-la como rendimento inflaria a rentabilidade.
 */
const payoutsOn = (entries: readonly CloseEntry[], date: DateOnly): Decimal =>
  entries
    .filter(
      (entry) =>
        entry.trade_date === date &&
        entry.kind === 'payout' &&
        entry.payout_kind !== 'amortization',
    )
    .reduce((total, entry) => total.plus(new Decimal(entry.net_amount)), zero);

export const planDailyClose = (context: DailyCloseContext): DailyClosePlan => {
  const upTo = context.reference_date;
  const until = (entry: CloseEntry): boolean => entry.trade_date <= upTo;

  const byAsset = new Map<string, CloseEntry[]>();
  for (const entry of context.entries) {
    if (entry.asset_id === null || !until(entry)) continue;
    const bucket = byAsset.get(entry.asset_id) ?? [];
    bucket.push(entry);
    byAsset.set(entry.asset_id, bucket);
  }

  const positions: PositionDailyWrite[] = [];
  const pricedAtCost: string[] = [];
  const health = { fresh: 0, stale: 0, manual: 0, missing: 0 };
  let totalValue = zero;

  for (const [assetId, bucket] of byAsset) {
    const asset = context.assets.get(assetId);

    const position = isCash(asset)
      ? cashPosition(context, assetId, asset)
      : applyLedger(bucket).position;

    const quantity = new Decimal(position.quantity);
    const costBasis = new Decimal(position.cost_basis);

    // Posição zerada sai de Posições e continua no histórico: a linha de hoje
    // simplesmente não é escrita.
    if (quantity.isZero() && costBasis.isZero()) continue;

    const valued = valuePosition(
      asset,
      quantity,
      costBasis,
      context.prices.get(assetId),
      context.curves.get(assetId),
      context.reference_date,
    );

    health[valued.kind] += 1;
    if (valued.kind === 'missing') pricedAtCost.push(assetId);

    totalValue = totalValue.plus(valued.market_value);

    positions.push({
      portfolio_id: context.portfolio_id,
      asset_id: assetId,
      position_date: context.reference_date,
      quantity: quantity.toDecimalPlaces(QUANTITY_DP).toFixed(QUANTITY_DP),
      avg_price: new Decimal(position.avg_price)
        .toDecimalPlaces(PRICE_DP)
        .toFixed(PRICE_DP),
      cost_basis: money(costBasis),
      market_value: money(valued.market_value),
      price_source_kind: valued.kind,
      accrued_interest: money(valued.accrued),
    });
  }

  const day = buildQuotaSeries(
    [
      {
        position_date: context.reference_date,
        total_value: money(totalValue),
        net_flow: money(flowOn(context.entries, context.reference_date)),
        payouts: money(payoutsOn(context.entries, context.reference_date)),
      },
    ],
    {
      ...(context.previous === null
        ? {}
        : {
            previous: {
              position_date: context.previous.position_date,
              total_value: context.previous.total_value,
              quota_value: context.previous.quota_value,
              quota_count: context.previous.quota_count,
              cumulative_contributions: context.previous.cumulative_contributions,
            },
          }),
    },
  )[0];

  return {
    positions,
    portfolio: {
      portfolio_id: context.portfolio_id,
      position_date: context.reference_date,
      total_value: day?.total_value ?? '0.00',
      net_flow: day?.net_flow ?? '0.00',
      income: day?.income ?? '0.00',
      payouts: day?.payouts ?? '0.00',
      quota_value: day?.quota_value ?? '1.000000000000',
      quota_count: day?.quota_count ?? '0.000000000000',
      cumulative_contributions: day?.cumulative_contributions ?? '0.00',
    },
    health,
    priced_at_cost: pricedAtCost,
  };
};

/**
 * A posição de caixa é o saldo da carteira naquela instituição, não a soma das
 * quantidades lançadas no ativo de caixa: uma compra tira dinheiro dali sem gerar
 * lançamento no caixa, e somar só os aportes contaria o mesmo real duas vezes.
 */
const cashPosition = (
  context: DailyCloseContext,
  assetId: string,
  asset: CloseAsset | undefined,
): {
  readonly quantity: string;
  readonly avg_price: string;
  readonly cost_basis: string;
} => {
  const institutionId = asset?.institution_id ?? null;

  // Transferir uma ação não move dinheiro: o valor líquido da perna é o custo que
  // viajou, não caixa. Já transferir o próprio caixa move, e é assim que "aporte
  // vindo de outra carteira" é lançado — então o filtro é pelo ativo da perna, não
  // pelo tipo do lançamento.
  const cashAssets = new Set(
    [...context.assets]
      .filter(([, candidate]) => candidate.b3_type === 'cash')
      .map(([id]) => id),
  );

  const relevant = context.entries.filter((entry) => {
    if (entry.trade_date > context.reference_date) return false;

    if (
      entry.kind === 'transfer' &&
      (entry.asset_id === null || !cashAssets.has(entry.asset_id))
    ) {
      return false;
    }

    // Sem instituição declarada no ativo de caixa, o saldo é só dos lançamentos
    // que apontam para ele: somar a carteira inteira contaria o mesmo real duas
    // vezes se houvesse outro caixa.
    return institutionId === null
      ? entry.asset_id === assetId
      : entry.institution_id === institutionId;
  });

  const balance = cashBalance(relevant);

  return { quantity: balance, avg_price: '1.00000000', cost_basis: balance };
};

/**
 * A ressalva que acompanha o total: quando qualquer linha não está `fresh`, o
 * número da tela carrega a observação em vez de ser apresentado como fechamento
 * do dia.
 */
export const totalIsReliable = (health: PriceHealth): boolean =>
  health.stale === 0 && health.missing === 0;

/**
 * O fator da curva de um título numa data. O principal é 1 de propósito: o plano
 * multiplica o fator pelo custo da posição no dia, e é isso que faz um resgate
 * parcial reduzir o valor na curva na mesma proporção.
 */
export const curveFor = (
  terms: FixedIncomeTerms,
  referenceDate: DateOnly,
  businessDays: readonly DateOnly[],
  indexFactors: readonly { readonly date: DateOnly; readonly daily_factor: string }[],
  projectedDailyFactor?: string,
): CurveValue =>
  curveValue({
    principal: '1',
    issued_at: terms.issued_at,
    // Título vencido para de render: a curva congela no vencimento.
    reference_date:
      terms.maturity_date !== null && referenceDate > terms.maturity_date
        ? terms.maturity_date
        : referenceDate,
    indexer: terms.indexer,
    rate: terms.rate,
    business_days: businessDays,
    index_factors: indexFactors,
    ...(projectedDailyFactor === undefined
      ? {}
      : { projected_daily_factor: projectedDailyFactor }),
  });
