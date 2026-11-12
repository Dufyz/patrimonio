import {
  backfillAsset,
  closeDay,
  collectMarketData,
  financeClock,
  financeUseCases,
  recalculatePortfolio,
  syncMarket,
} from '@patrimonio/application';
import type { Clock, UnitOfWork } from '@patrimonio/application';
import { success, uuidV7 } from '@patrimonio/shared';

import type { StageUseCases } from '../infra/define-stage.js';
import { scriptedIndices, scriptedQuotes, scriptedTreasury } from './market.js';
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
  syncFinance: financeUseCases({
    unitOfWork,
    clock: financeClock(clock),
    newId: () => uuidV7(),
  }).syncDaily,
  // A sincronização de verdade, com as fontes roteirizadas. Os passos que não
  // são o assunto dos testes de estágio (histórico, catálogos) respondem vazio.
  syncMarket: syncMarket({
    unitOfWork,
    clock,
    collectDay: collectMarketData({
      unitOfWork,
      clock,
      quotes: scriptedQuotes(script),
      indices: scriptedIndices(script),
      treasury: scriptedTreasury(script),
    }),
    loadPriceHistory: async () => success(null),
    loadIndexHistory: async () => success(null),
    syncPriceHistory: async () => success(null),
    backfillAsset: async () => success(null),
    refreshInstrumentCatalog: async () => success(null),
  }),
  backfillAsset: backfillAsset({
    unitOfWork,
    clock,
    quotes: scriptedQuotes(script),
  }),
});
