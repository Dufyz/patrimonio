import type {
  ComputedPriceKind,
  DateOnly,
  RecalcStatus,
} from '@patrimonio/domain';
import type { Either } from '@patrimonio/shared';

import type { AppError } from '../errors/app-error.js';

/**
 * A leitura da tela de abertura, inteira, numa consulta.
 *
 * O número de consultas é um requisito de produto e não uma preferência: o
 * banco fica em outra rede, e a tela que faz oito leituras em sequência paga
 * oito vezes a latência — é a diferença entre abrir e esperar abrir. T-11 põe
 * o limite por rota em duas, e esta rota gasta uma aqui e outra nos alertas.
 *
 * Por isso o repositório devolve um instantâneo e não sete listas: quem decide
 * o que exibir é o caso de uso, com `packages/calc`; o que a consulta faz é
 * trazer os fatos do dia — série, posições, alvo e a carteira — de uma vez.
 */

/** Um dia da série da carteira, como o fechamento o gravou. */
export type OverviewDayRow = {
  readonly position_date: DateOnly;
  readonly total_value: string;
  readonly net_flow: string;
  readonly income: string;
  readonly payouts: string;
  readonly cumulative_contributions: string;
  readonly quota_value: string | null;
};

/**
 * Os três fechamentos de referência que a tela compara, cada um podendo estar
 * fora da janela pedida: a variação do dia olha o fechamento anterior, a do mês
 * olha o último dia do mês passado, e o retorno da janela parte do dia anterior
 * ao começo dela.
 */
export type OverviewAnchors = {
  readonly previous_day: OverviewDayRow | null;
  readonly month_base: OverviewDayRow | null;
  readonly window_base: OverviewDayRow | null;
};

export type OverviewPortfolioRow = {
  readonly portfolio_id: string;
  readonly name: string;
  readonly purpose: string | null;
  readonly tolerance_pp: string;
  readonly recalc_status: RecalcStatus;
  /** O valor da carteira na data de referência. Nulo quando nunca fechou. */
  readonly total_value: string | null;
};

export type OverviewPositionRow = {
  readonly asset_id: string;
  readonly ticker: string;
  readonly name: string;
  /** Decide se o papel se chama pelo código ou pelo nome, como em T-02 e T-03. */
  readonly b3_type: string | null;
  readonly color_token: string | null;
  readonly value: string;
  /** O estado do preço do papel na carteira. */
  readonly price_source_kind: ComputedPriceKind;
};

export type OverviewCategoryRow = {
  readonly category_id: string;
  readonly category_name: string;
  readonly group_id: string | null;
  readonly group_name: string | null;
  readonly color_token: string;
  readonly value: string;
};

export type OverviewTargetRow = {
  readonly category_id: string;
  readonly target_pct: string;
};

export type OverviewSnapshot = {
  /** O último fechamento em ou antes da data pedida. Nulo antes do primeiro. */
  readonly reference_date: DateOnly | null;
  /** O primeiro fechamento da carteira: é o que "Início" significa. */
  readonly inception: DateOnly | null;
  readonly days: readonly OverviewDayRow[];
  readonly anchors: OverviewAnchors;
  /** A carteira pedida. Nulo quando ela não existe ou está arquivada. */
  readonly portfolio: OverviewPortfolioRow | null;
  readonly positions: readonly OverviewPositionRow[];
  readonly categories: readonly OverviewCategoryRow[];
  readonly targets: readonly OverviewTargetRow[];
};

export type OverviewQuery = {
  readonly portfolio_id: string;
  readonly on_date: DateOnly;
  readonly from: DateOnly;
  readonly to: DateOnly;
};

export type OverviewRepository = {
  readonly snapshot: (
    query: OverviewQuery,
  ) => Promise<Either<AppError, OverviewSnapshot>>;
};
