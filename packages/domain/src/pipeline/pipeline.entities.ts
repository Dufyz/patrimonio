/** Os seis estágios do pipeline, um por fila. */
export const STAGES = [
  'recalc',
  'market',
  'close',
  'alerts',
  'import',
  'backup',
] as const;

export type Stage = (typeof STAGES)[number];

export const isStage = (value: unknown): value is Stage =>
  typeof value === 'string' && (STAGES as readonly string[]).includes(value);

/**
 * Estado do recálculo de uma carteira. Nenhum caso de uso escreve isto
 * diretamente: o plano devolve um `StageResult` e o `apply` aplica
 * `transition()`.
 */
export const RECALC_STATUSES = ['idle', 'queued', 'running', 'failed'] as const;

export type RecalcStatus = (typeof RECALC_STATUSES)[number];

export type StageOutcome = 'requested' | 'started' | 'succeeded' | 'failed';

export type StageResult = {
  readonly stage: Stage;
  readonly outcome: StageOutcome;
  /**
   * Só em `failed`: 5xx é transitória e volta para a fila, 4xx é definitiva.
   * O `defineStage` traduz o `statusCode` do `AppError` neste booleano.
   */
  readonly recoverable?: boolean;
};

export type Transition = {
  readonly recalc_status: RecalcStatus;
  /** O estágio que o fim deste pede em seguida, se pede algum. */
  readonly next: Stage | null;
};
