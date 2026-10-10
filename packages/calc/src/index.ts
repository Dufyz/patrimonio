/**
 * O motor financeiro: preço médio, cota, marcação na curva, alocação, IR e
 * projeção. Sem banco, sem HTTP, sem relógio — a data entra como parâmetro, e é
 * o que torna o teste determinístico e permite simular um ano de fechamentos em
 * segundos.
 *
 * Um módulo por pasta, cada um com fixtures conferidas à mão em
 * `src/__fixtures__/<modulo>/`:
 *
 *   average_price · quota · fixed_income · allocation · goals · tax
 *
 * A cobertura exigida aqui é 100%, sem exceção: são funções puras, e é o único
 * lugar em que a métrica significa alguma coisa.
 */

// ─── Preço médio e custo ─────────────────────────────────────────────────────
export {
  LEDGER_KINDS,
  applyLedger,
  cashBalance,
  ledgerEffects,
  positionAt,
  sortEntries,
} from './average_price/ledger.js';
export type {
  ApplyOptions,
  EntryEffect,
  LedgerEntry,
  LedgerKind,
  LedgerState,
  Position,
  RealizedSale,
} from './average_price/ledger.js';

export { amountsFor, moneyDifference, totalAmount } from './average_price/amounts.js';
export type { AmountInput, Amounts } from './average_price/amounts.js';

// ─── Imposto ─────────────────────────────────────────────────────────────────
export { payoutGross, perShareFromGross, withheldFromGross } from './tax/jcp.js';

export {
  DEFAULT_TAX_RATES,
  EXEMPT_CLASSES,
  MONTHLY_EXEMPTION_BRL,
  TAXABLE_CLASSES,
  annotationsByTransaction,
  taxLedger,
} from './tax/variable_income.js';
export type {
  TaxLedger,
  TaxMonth,
  TaxPolicy,
  TaxableClass,
  TaxableSale,
  TaxedSale,
} from './tax/variable_income.js';

// ─── Renda fixa ──────────────────────────────────────────────────────────────
export {
  BUSINESS_DAYS_PER_YEAR,
  INDEXERS,
  accrualDays,
  annualToPeriodFactor,
  curveSeries,
  curveValue,
} from './fixed_income/curve.js';
export type {
  CurveIndexer,
  CurveInput,
  CurveValue,
  IndexFactor,
} from './fixed_income/curve.js';

export {
  REGRESSIVE_BRACKETS,
  TAX_REGIMES,
  redemption,
  regressiveRate,
} from './fixed_income/regressive.js';
export type {
  FixedIncomeTaxRegime,
  Redemption,
  RedemptionInput,
} from './fixed_income/regressive.js';

// ─── Cota, janelas e benchmark ───────────────────────────────────────────────
export {
  INITIAL_QUOTA_VALUE,
  buildQuotaSeries,
  seedFrom,
  totalFromQuota,
} from './quota/series.js';
export type { DailyTotals, QuotaDay, QuotaOptions, QuotaSeed } from './quota/series.js';

export {
  WINDOWS,
  allWindows,
  annualizedPct,
  basePoint,
  resolveWindow,
  returnBetween,
  returnPct,
  windowStart,
} from './quota/windows.js';
export type { QuotaPoint, WindowKey, WindowReturn } from './quota/windows.js';

export {
  REBALANCES,
  benchmarkReturn,
  benchmarkSeries,
  differencePp,
} from './quota/benchmark.js';
export type {
  BenchmarkDefinition,
  BenchmarkInput,
  BenchmarkPart,
  BenchmarkPoint,
  BenchmarkReturn,
  FactorsByIndex,
  Rebalance,
} from './quota/benchmark.js';

export { indexCodesOf, parseBenchmarkDefinition } from './quota/definition.js';

export { decomposeByMonth, yearTotals } from './quota/decomposition.js';
export type {
  DecompositionDay,
  DecompositionOptions,
  MonthlyDecomposition,
} from './quota/decomposition.js';

// ─── Alocação ────────────────────────────────────────────────────────────────
export {
  costBasisByAsset,
  deviationPp,
  sumValues,
  weightPct,
} from './allocation/weights.js';
export type { AssetLedgerEntry } from './allocation/weights.js';

export { duplicatedCategories, sumTargets } from './allocation/targets.js';
export type { AllocationTarget, TargetSum } from './allocation/targets.js';

export { composeAllocation, outOfTolerance } from './allocation/composition.js';
export type {
  AllocationLine,
  Composition,
  CompositionNode,
  CompositionOptions,
  CompositionTarget,
} from './allocation/composition.js';

export { planContribution } from './allocation/contribution.js';
export type {
  ContributionLine,
  ContributionPlan,
  ContributionShare,
} from './allocation/contribution.js';

export { fgcHeadroom, fgcUsedPct } from './allocation/fgc.js';
export type { FgcHeadroom } from './allocation/fgc.js';

// ─── Visão geral ─────────────────────────────────────────────────────────────
export {
  growthSeries,
  periodFlows,
  valueChange,
  weighByValue,
} from './overview/summary.js';
export type {
  GrowthPoint,
  OverviewDay,
  PeriodFlows,
  ValueChange,
  WeighedItem,
  WeighedResult,
} from './overview/summary.js';

// ─── Objetivos ───────────────────────────────────────────────────────────────
export {
  averageMonthlyContribution,
  arrivalMonth,
  contributionTable,
  monthlyRate,
  projectGoal,
} from './goals/projection.js';
export type {
  ContributionOption,
  GoalInput,
  GoalProjection,
  MonthlyFlow,
} from './goals/projection.js';
export {
  contributionLadder,
  expectedProgress,
  factorToPct,
  goalStanding,
  goalTrajectory,
  nominalRate,
  normalizeRate,
  parseReturnAssumption,
} from './goals/trajectory.js';
export type {
  ExpectedProgressInput,
  GoalStanding,
  LadderEntry,
  ReturnAssumption,
  TrajectoryInput,
} from './goals/trajectory.js';

// ─── Suporte ─────────────────────────────────────────────────────────────────
export {
  MONEY_SCALE,
  PRICE_SCALE,
  QUANTITY_SCALE,
  isNegativeAmount,
  isZeroAmount,
  multiplyMoney,
  toMoney,
  toPrice,
  toQuantity,
} from './support/scale.js';

export {
  addCalendarDays,
  addMonths,
  calendarDaysBetween,
  monthOf,
  monthStart,
  monthsBetween,
} from './support/dates.js';

// ─── Séries de índice ────────────────────────────────────────────────────────
export {
  INDEX_UNITS,
  accumulate,
  dailyFactorsFrom,
  factorFromDailyPct,
  factorFromMonthlyPct,
} from './index_series/factors.js';
export type { DailyFactor, IndexObservation, IndexUnit } from './index_series/factors.js';

// ─── Série de preço ajustada ─────────────────────────────────────────────────
export { adjustForEvents } from './prices/adjusted.js';
export type {
  AdjustedPoint,
  AdjustedSeries,
  PriceEvent,
  PricePoint,
} from './prices/adjusted.js';

// ─── Desempenho ──────────────────────────────────────────────────────────────
export {
  benchmarkCumulative,
  benchmarkPeriodReturn,
  cumulativeReturns,
  datesBetween,
  measurementCalendar,
  yearReturns,
} from './performance/periods.js';
export type { BenchmarkSpec, YearReturn } from './performance/periods.js';

export { modifiedDietz } from './performance/dietz.js';
export type { DietzFlow, DietzInput } from './performance/dietz.js';
