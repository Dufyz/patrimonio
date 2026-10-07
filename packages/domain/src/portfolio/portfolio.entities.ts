import type { RecalcStatus } from '../pipeline/pipeline.entities.js';
import type { DateOnly } from '../support/date_only.js';

/**
 * A carteira separa o dinheiro por propósito. Ela carrega o benchmark, a
 * tolerância de desvio e as regras de rebalanceamento, porque é o escopo em que
 * essas perguntas fazem sentido: "estou desenquadrado" só tem resposta dentro
 * de um propósito.
 */
export const REBALANCE_MODES = ['contributions_only', 'buy_and_sell'] as const;

export type RebalanceMode = (typeof REBALANCE_MODES)[number];

export const isRebalanceMode = (value: unknown): value is RebalanceMode =>
  typeof value === 'string' && (REBALANCE_MODES as readonly string[]).includes(value);

export type Portfolio = {
  readonly id: string;
  readonly name: string;
  /** Texto livre: "independência financeira", "entrada do imóvel". */
  readonly purpose: string | null;
  readonly benchmark_id: string | null;
  /** Desvio aceito antes de virar alerta, em pontos percentuais. */
  readonly tolerance_pp: string;
  readonly max_asset_weight_pct: string | null;
  readonly rebalance_mode: RebalanceMode;
  readonly review_every_months: number | null;
  readonly sort_order: number;
  /**
   * As quatro colunas abaixo são escritas só pela máquina de estados do
   * pipeline. Nenhuma rota as aceita no `POST` nem no `PATCH`.
   */
  readonly recalc_status: RecalcStatus;
  readonly recalc_from_date: DateOnly | null;
  readonly recalc_error: string | null;
  readonly recalc_updated_at: string | null;
  /** Sai da barra lateral, mantém o histórico e libera o nome. */
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

/** O alvo de alocação de uma carteira, por categoria. Soma 100 ou zero. */
export type StrategyTarget = {
  readonly portfolio_id: string;
  readonly category_id: string;
  readonly target_pct: string;
  readonly created_at: string;
  readonly updated_at: string;
};
