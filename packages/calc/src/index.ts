/**
 * O motor financeiro: preço médio, cota, marcação na curva, alocação, IR e
 * projeção. Sem banco, sem HTTP, sem relógio — a data entra como parâmetro, e é
 * o que torna o teste determinístico e permite simular um ano de fechamentos em
 * segundos.
 *
 * Os módulos entram em E3, um por pasta, cada um com fixtures conferidas à mão
 * em `src/__fixtures__/<modulo>/`:
 *
 *   average_price · quota · fixed_income · allocation · goals · tax
 *
 * A cobertura exigida aqui é 100%, sem exceção: são funções puras, e é o único
 * lugar em que a métrica significa alguma coisa.
 */
export {
  LEDGER_KINDS,
  applyLedger,
  cashBalance,
  positionAt,
  sortEntries,
} from './average_price/ledger.js';
export type {
  ApplyOptions,
  LedgerEntry,
  LedgerKind,
  LedgerState,
  Position,
  RealizedSale,
} from './average_price/ledger.js';

export { duplicatedCategories, sumTargets } from './allocation/targets.js';
export { fgcHeadroom } from './allocation/fgc.js';
export type { FgcHeadroom } from './allocation/fgc.js';
export type { AllocationTarget, TargetSum } from './allocation/targets.js';
