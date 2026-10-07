import type {
  RecalcStatus,
  Stage,
  StageOutcome,
  StageResult,
  Transition,
} from './pipeline.entities.js';

/**
 * A tabela de transições do pipeline, declarada uma vez. Nenhum caso de uso
 * escreve `recalc_status`: o plano devolve o `StageResult` e o `apply` aplica
 * esta função.
 *
 * `next` é a corrente do fechamento diário — mercado, fechamento, alertas — e o
 * pedido de alertas depois de um recálculo, para o painel refletir o número novo.
 *
 * `recalc_status` descreve o estado do escopo da carteira. Nos estágios globais
 * (`market` e `backup`) não há carteira no escopo e o `apply` ignora o valor.
 */
const TABLE: Record<Stage, Record<StageOutcome, Transition>> = {
  recalc: {
    requested: { recalc_status: 'queued', next: null },
    started: { recalc_status: 'running', next: null },
    succeeded: { recalc_status: 'idle', next: 'alerts' },
    failed: { recalc_status: 'failed', next: null },
  },
  market: {
    requested: { recalc_status: 'idle', next: null },
    started: { recalc_status: 'idle', next: null },
    succeeded: { recalc_status: 'idle', next: 'close' },
    failed: { recalc_status: 'idle', next: null },
  },
  close: {
    requested: { recalc_status: 'queued', next: null },
    started: { recalc_status: 'running', next: null },
    succeeded: { recalc_status: 'idle', next: 'alerts' },
    failed: { recalc_status: 'failed', next: null },
  },
  alerts: {
    requested: { recalc_status: 'idle', next: null },
    started: { recalc_status: 'idle', next: null },
    succeeded: { recalc_status: 'idle', next: null },
    failed: { recalc_status: 'idle', next: null },
  },
  import: {
    requested: { recalc_status: 'queued', next: null },
    started: { recalc_status: 'running', next: null },
    // Importar é escrever lançamento: o patrimônio só fica certo depois do
    // recálculo que ela pede.
    succeeded: { recalc_status: 'queued', next: 'recalc' },
    failed: { recalc_status: 'failed', next: null },
  },
  backup: {
    requested: { recalc_status: 'idle', next: null },
    started: { recalc_status: 'idle', next: null },
    succeeded: { recalc_status: 'idle', next: null },
    failed: { recalc_status: 'idle', next: null },
  },
};

/** Estágios cujo escopo é uma carteira: só eles movem `recalc_status`. */
const PORTFOLIO_SCOPED: ReadonlySet<Stage> = new Set<Stage>([
  'recalc',
  'close',
  'import',
]);

export const isPortfolioScoped = (stage: Stage): boolean => PORTFOLIO_SCOPED.has(stage);

export function transition(result: StageResult): Transition {
  const row = TABLE[result.stage][result.outcome];

  // Falha transitória volta para a própria fila; definitiva para o pipeline.
  if (result.outcome === 'failed' && result.recoverable === true) {
    const status: RecalcStatus = isPortfolioScoped(result.stage) ? 'queued' : 'idle';
    return { recalc_status: status, next: result.stage };
  }

  return row;
}
