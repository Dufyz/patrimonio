import type { DateOnly, RecalcStatus } from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * A leitura da tela de Desempenho, em **duas** consultas.
 *
 * O que decide a divisão é uma dependência: a segunda consulta precisa de coisas
 * que só a primeira sabe — qual é o último fechamento, qual é o primeiro, e de
 * que índices os benchmarks escolhidos dependem. Por isso a primeira devolve a
 * série e o catálogo, e a segunda recebe as datas e os códigos já resolvidos e
 * devolve o que depende deles: fatores de índice e valor e fluxo de cada
 * classe.
 *
 * O limite de duas é o mesmo da Visão geral, e pela mesma razão: o banco fica
 * em outra rede, e cada leitura a mais aparece na abertura da tela.
 */

/** Um dia da série da carteira. */
export type PerformanceDayRow = {
  readonly position_date: DateOnly;
  readonly total_value: string;
  readonly net_flow: string;
  readonly income: string;
  readonly payouts: string;
  readonly quota_value: string | null;
};

export type PerformanceSnapshotPortfolio = {
  readonly portfolio_id: string;
  readonly name: string;
  readonly recalc_status: RecalcStatus;
  readonly benchmark_id: string | null;
  /** O valor na data de referência, ou no último fechamento da carteira. */
  readonly total_value: string | null;
};

/**
 * O benchmark como o banco o guarda: a definição ainda é JSON. Quem a
 * interpreta é `parseBenchmarkDefinition`, de `calc` — `db` não importa o motor.
 */
export type PerformanceBenchmarkRow = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly rebalance: string;
  readonly definition: unknown;
};

export type PerformanceSnapshot = {
  /** O último fechamento em ou antes da data pedida. Nulo antes do primeiro. */
  readonly reference_date: DateOnly | null;
  /** O primeiro fechamento da carteira: é o que "Início" significa. */
  readonly inception: DateOnly | null;
  /** A história inteira da carteira até a referência, em ordem de data. */
  readonly days: readonly PerformanceDayRow[];
  /** A carteira pedida. Nulo quando ela não existe ou está arquivada. */
  readonly portfolio: PerformanceSnapshotPortfolio | null;
  readonly benchmarks: readonly PerformanceBenchmarkRow[];
};

export type PerformanceSnapshotQuery = {
  readonly portfolio_id: string;
  readonly on_date: DateOnly;
};

/**
 * Um ponto no tempo que a segunda consulta mede. Os rótulos são os das janelas
 * mais `reference`.
 */
export type PerformancePoint = {
  readonly label: string;
  readonly date: DateOnly;
};

export type PerformanceBreakdownQuery = {
  readonly portfolio_id: string;
  readonly reference: DateOnly;
  readonly points: readonly PerformancePoint[];
  /** Os índices de que os benchmarks escolhidos dependem. Vazio não lê fator. */
  readonly index_codes: readonly string[];
  /** Fatores depois desta data e até a referência. */
  readonly factors_from: DateOnly;
  /** Fluxos depois desta data e até a referência. */
  readonly flows_from: DateOnly;
};

export type PerformanceCategoryRow = {
  readonly category_id: string;
  readonly name: string;
  readonly color_token: string;
  /** Caixa não rende por si, e o retorno dele não se mede por Dietz. */
  readonly is_cash: boolean;
};

export type PerformanceClassValue = {
  readonly category_id: string;
  readonly label: string;
  readonly value: string;
};

/**
 * O que entrou na classe (positivo) ou saiu dela (negativo) num dia, e quanto
 * ela recebeu de provento. Provento não é fluxo: é resultado pago em caixa.
 */
export type PerformanceClassFlow = {
  readonly category_id: string;
  readonly trade_date: DateOnly;
  readonly flow: string;
  readonly income: string;
};

export type PerformanceBreakdown = {
  /** Fator diário por índice e por data, como `index_quote` o guarda. */
  readonly factors: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly categories: readonly PerformanceCategoryRow[];
  readonly class_values: readonly PerformanceClassValue[];
  readonly class_flows: readonly PerformanceClassFlow[];
};

export type PerformanceRepository = {
  readonly snapshot: (
    query: PerformanceSnapshotQuery,
  ) => Promise<Either<AppError, PerformanceSnapshot>>;
  readonly breakdown: (
    query: PerformanceBreakdownQuery,
  ) => Promise<Either<AppError, PerformanceBreakdown>>;
};
