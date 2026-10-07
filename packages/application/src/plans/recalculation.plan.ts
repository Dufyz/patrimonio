import { applyLedger, curveSeries } from '@patrimonio/calc';
import type { CurveValue } from '@patrimonio/calc';
import { indexForIndexer } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';

import type {
  PortfolioDailyWrite,
  PositionDailyWrite,
  RealizedResultWrite,
} from '../interfaces/projection.repository.js';
import { planDailyClose } from './daily_close.plan.js';
import type {
  CloseAsset,
  CloseEntry,
  CloseSeed,
  PriceOn,
} from './daily_close.plan.js';

/**
 * Reconstruir a projeção de uma carteira a partir de uma data é apagar e regravar
 * do livro, nunca corrigir no lugar. É a operação que sustenta o modelo: se
 * reconstruir do zero produz um estado diferente do incremental, alguma projeção
 * guarda informação que não está na fonte — e aí o backup não basta e o histórico
 * não é corrigível.
 *
 * O plano é puro e trabalha inteiro em memória. O contexto é carregado numa
 * leitura: dez anos de reconstrução que voltassem ao banco um dia por vez não
 * terminariam, porque o banco está em outra rede.
 */
export type TaxAnnotation = {
  readonly exempt: boolean;
  readonly loss_offset: string;
};

export type RecalculationContext = {
  readonly portfolio_id: string;
  readonly from_date: DateOnly;
  readonly through_date: DateOnly;
  /** Dias úteis a reconstruir, em ordem crescente. */
  readonly business_days: readonly DateOnly[];
  /**
   * O calendário completo desde a aplicação mais antiga, que é o que a curva
   * precisa: o fator acumulado conta dias úteis anteriores ao intervalo.
   */
  readonly calendar: readonly DateOnly[];
  /** O livro inteiro da carteira até `through_date`. */
  readonly entries: readonly CloseEntry[];
  readonly assets: ReadonlyMap<string, CloseAsset>;
  /** A série de preço por ativo, em ordem de data. */
  readonly prices: ReadonlyMap<string, readonly PriceOn[]>;
  /** Fator diário por código de índice e data. */
  readonly index_factors: ReadonlyMap<string, ReadonlyMap<DateOnly, string>>;
  /** Fator diário usado no dia útil sem índice publicado, por código. */
  readonly projected_factors?: ReadonlyMap<string, string> | undefined;
  /** A linha do dia anterior a `from_date`. Nula quando se reconstrói do início. */
  readonly previous: CloseSeed | null;
  /** O que a apuração decidiu sobre cada venda, vindo de `planTaxes`. */
  readonly tax_annotations?: ReadonlyMap<string, TaxAnnotation> | undefined;
};

export type RecalculationReport = {
  readonly portfolio_id: string;
  readonly from_date: DateOnly;
  readonly through_date: DateOnly;
  readonly days: number;
  readonly positions: number;
  readonly realized: number;
  /** Dias em que alguma linha não ficou `fresh`. */
  readonly days_with_stale_price: number;
  readonly assets_priced_at_cost: readonly string[];
};

export type RecalculationPlan = {
  /** A projeção é apagada a partir daqui antes de ser regravada. */
  readonly delete_from: DateOnly;
  readonly positions: readonly PositionDailyWrite[];
  readonly portfolio_days: readonly PortfolioDailyWrite[];
  readonly realized: readonly RealizedResultWrite[];
  readonly report: RecalculationReport;
};

/**
 * O preço vigente de cada ativo em cada dia, resolvido numa passada. A alternativa
 * — procurar o último preço anterior a cada dia — é a consulta que fica lenta, e
 * aqui ela seria repetida por ativo e por dia.
 */
const priceWalker = (
  prices: ReadonlyMap<string, readonly PriceOn[]>,
): ((date: DateOnly) => ReadonlyMap<string, PriceOn>) => {
  const cursors = new Map<string, number>();
  const current = new Map<string, PriceOn>();

  return (date: DateOnly): ReadonlyMap<string, PriceOn> => {
    for (const [assetId, series] of prices) {
      let cursor = cursors.get(assetId) ?? 0;

      while (cursor < series.length) {
        const candidate = series[cursor];
        if (candidate === undefined || candidate.price_date > date) break;
        current.set(assetId, candidate);
        cursor += 1;
      }

      cursors.set(assetId, cursor);
    }

    return new Map(current);
  };
};

/**
 * O fator da curva de cada título em cada dia, acumulado numa passada por título.
 * O principal é 1: o plano do dia multiplica pelo custo da posição.
 */
const curveLookup = (
  context: RecalculationContext,
): ReadonlyMap<string, ReadonlyMap<DateOnly, CurveValue>> => {
  const byAsset = new Map<string, ReadonlyMap<DateOnly, CurveValue>>();

  for (const [assetId, asset] of context.assets) {
    const terms = asset.fixed_income;
    if (terms === null) continue;

    // Prefixado não tem índice: a taxa contratada é a remuneração inteira, e a
    // série entra vazia em vez de inexistente.
    const code = indexForIndexer(terms.indexer);
    const factors: ReadonlyMap<DateOnly, string> =
      code === null ? new Map() : (context.index_factors.get(code) ?? new Map());
    const projected =
      code === null ? undefined : context.projected_factors?.get(code);

    // Título vencido para de render: o acumulado congela no vencimento.
    const through =
      terms.maturity_date !== null && terms.maturity_date < context.through_date
        ? terms.maturity_date
        : context.through_date;

    const series = curveSeries({
      principal: '1',
      issued_at: terms.issued_at,
      indexer: terms.indexer,
      rate: terms.rate,
      business_days: context.calendar,
      index_factors: [...factors].map(([date, daily_factor]) => ({ date, daily_factor })),
      ...(projected === undefined ? {} : { projected_daily_factor: projected }),
      from_date: context.from_date,
      through_date: through,
    });

    const byDate = new Map<DateOnly, CurveValue>(
      series.map((value): readonly [DateOnly, CurveValue] => [
        value.reference_date,
        value,
      ]),
    );

    // Depois do vencimento o valor é o do vencimento, não zero e não crescente.
    const last = series[series.length - 1];
    if (last !== undefined) {
      for (const day of context.business_days) {
        if (day > through) byDate.set(day, { ...last, reference_date: day });
      }
    }

    byAsset.set(assetId, byDate);
  }

  return byAsset;
};

/**
 * O resultado realizado de cada venda da carteira, com o que a apuração decidiu.
 * A apuração é global — o limite de isenção olha a soma das vendas do mês em todas
 * as carteiras —, então ela entra pelo contexto em vez de ser calculada aqui.
 */
const realizedFor = (context: RecalculationContext): readonly RealizedResultWrite[] => {
  const rows: RealizedResultWrite[] = [];

  const byAsset = new Map<string, CloseEntry[]>();
  for (const entry of context.entries) {
    if (entry.asset_id === null) continue;
    const bucket = byAsset.get(entry.asset_id) ?? [];
    bucket.push(entry);
    byAsset.set(entry.asset_id, bucket);
  }

  for (const [assetId, bucket] of byAsset) {
    for (const sale of applyLedger(bucket).realized) {
      if (sale.entry_id === null) continue;
      // Só o intervalo reconstruído é regravado: o que está fora dele continua
      // valendo, e reescrevê-lo seria trabalho sem efeito.
      if (sale.trade_date < context.from_date) continue;
      if (sale.trade_date > context.through_date) continue;

      const annotation = context.tax_annotations?.get(sale.entry_id);

      rows.push({
        transaction_id: sale.entry_id,
        portfolio_id: context.portfolio_id,
        asset_id: assetId,
        trade_date: sale.trade_date,
        proceeds: sale.proceeds,
        cost_consumed: sale.cost_consumed,
        result: sale.result,
        exempt: annotation?.exempt ?? false,
        loss_offset: annotation?.loss_offset ?? '0.00',
      });
    }
  }

  return rows.sort((left, right) =>
    left.trade_date < right.trade_date ? -1 : left.trade_date > right.trade_date ? 1 : 0,
  );
};

export const planRecalculation = (
  context: RecalculationContext,
): RecalculationPlan => {
  const nextPrices = priceWalker(context.prices);
  const curves = curveLookup(context);

  const positions: PositionDailyWrite[] = [];
  const days: PortfolioDailyWrite[] = [];
  const pricedAtCost = new Set<string>();

  let previous: CloseSeed | null = context.previous;
  let daysWithStale = 0;

  for (const date of context.business_days) {
    const prices = nextPrices(date);

    const curvesOn = new Map<string, CurveValue>();
    for (const [assetId, byDate] of curves) {
      const value = byDate.get(date);
      if (value !== undefined) curvesOn.set(assetId, value);
    }

    const close = planDailyClose({
      portfolio_id: context.portfolio_id,
      reference_date: date,
      entries: context.entries,
      assets: context.assets,
      prices,
      curves: curvesOn,
      previous,
    });

    positions.push(...close.positions);
    days.push(close.portfolio);

    if (close.health.stale > 0 || close.health.missing > 0) daysWithStale += 1;
    for (const assetId of close.priced_at_cost) pricedAtCost.add(assetId);

    // A linha de hoje é o ponto de partida de amanhã: é o que faz reconstruir um
    // pedaço dar o mesmo resultado que reconstruir tudo.
    previous = close.portfolio;
  }

  const realized = realizedFor(context);

  return {
    delete_from: context.from_date,
    positions,
    portfolio_days: days,
    realized,
    report: {
      portfolio_id: context.portfolio_id,
      from_date: context.from_date,
      through_date: context.through_date,
      days: days.length,
      positions: positions.length,
      realized: realized.length,
      days_with_stale_price: daysWithStale,
      assets_priced_at_cost: [...pricedAtCost],
    },
  };
};
