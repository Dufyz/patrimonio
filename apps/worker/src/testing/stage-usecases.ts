import {
  backfillAsset,
  closeDay,
  collectMarketData,
  recalculatePortfolio,
  reconcileAlerts,
} from '@patrimonio/application';
import type { Clock, UnitOfWork } from '@patrimonio/application';

import type { StageUseCases } from '../infra/define-stage.js';
import {
  scriptedIndices,
  scriptedQuotes,
  scriptedTreasury,
} from './market.js';
import type { Script } from './market.js';

/**
 * Os casos de uso que `StageDeps` exige, montados sobre a unidade de trabalho do
 * teste. Não são dublês: são os casos de uso de verdade, contra Postgres e Redis
 * reais, porque o que os testes de estágio medem é o caminho do pipeline e não o
 * cálculo. O único roteiro é o das fontes externas.
 */
export const stageUseCases = (
  unitOfWork: UnitOfWork,
  clock: Clock,
  script: Script = {},
): StageUseCases => ({
  recalculatePortfolio: recalculatePortfolio({ unitOfWork, clock }),
  closeDay: closeDay({ unitOfWork, clock }),
  reconcileAlerts: reconcileAlerts({ unitOfWork, clock }),
  collectMarketData: collectMarketData({
    unitOfWork,
    clock,
    quotes: scriptedQuotes(script),
    indices: scriptedIndices(script),
    treasury: scriptedTreasury(script),
    staleAfterDays: 3,
  }),
  backfillAsset: backfillAsset({
    unitOfWork,
    clock,
    quotes: scriptedQuotes(script),
  }),
});
