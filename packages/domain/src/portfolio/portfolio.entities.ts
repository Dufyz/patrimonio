import type { RecalcStatus } from '../pipeline/pipeline.entities.js';
import type { DateOnly } from '../support/date_only.js';

/** Desvio aceito antes de virar alerta, em pontos percentuais. */
export const TOLERANCE_PP = '5.00';

export type Portfolio = {
  readonly id: string;
  readonly name: string;
  /** O benchmark como texto canônico: `CDI`, `IPCA+6`, `110%CDI`. */
  readonly benchmark: string | null;
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
