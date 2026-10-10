import {
  archiveAsset,
  createAsset,
  confirmCorporateEvent,
  confirmPayout,
  createCashMovement,
  createPayout,
  createCategory,
  createTransaction,
  createFixedIncomeAsset,
  createInstitution,
  createPortfolio,
  deleteAsset,
  deleteManualPrice,
  deleteTransaction,
  dismissPayout,
  deleteCategory,
  deleteInstitution,
  deletePortfolio,
  getAsset,
  getAssetPage,
  getStatement,
  searchGlobal,
  getAssetPriceSeries,
  getMarketHealth,
  getOverview,
  getAllocation,
  getGoals,
  getSettings,
  requestBackup,
  getPerformance,
  getTransaction,
  interpretTransaction,
  getFgcExposure,
  getPortfolio,
  listAssets,
  listManualPrices,
  listTransactions,
  listCategories,
  listCorporateEvents,
  listInstitutions,
  listPortfolios,
  listPositions,
  putStrategy,
  setPortfolioArchived,
  previewPayout,
  previewTransaction,
  previewUpdate,
  registerCorporateEvent,
  setManualPrice,
  refreshMarketData,
  undoDeletion,
  updateAsset,
  updateTransaction,
  updateCategory,
  updateInstitution,
  createDebouncePolicy,
  updatePortfolio,
} from '@patrimonio/application';
import type {
  Clock,
  TransactionalRepositories,
  UnitOfWork,
} from '@patrimonio/application';
import {
  closeDatabase,
  createConnection,
  createRepositories,
  createUnitOfWork,
} from '@patrimonio/db';
import type { Sql } from '@patrimonio/db';
import { environment } from '@patrimonio/env';
import { BRAPI_FREE_MONTHLY_CEILING } from '@patrimonio/market';
import {
  closeQueues,
  closeRedisConnection,
  createQueues,
  createRedisConnection,
} from '@patrimonio/queue';
import type { Queues, RedisConnection } from '@patrimonio/queue';

import { systemClock } from './infra/config/clock.js';

/**
 * Monta repositórios, gateways e casos de uso uma vez, no boot. Nenhum
 * controller instancia dependência: ele recebe o caso de uso pronto, e trocar
 * uma implementação é mudar uma linha daqui.
 */
export const createApiUseCases = (deps: {
  readonly unitOfWork: UnitOfWork;
  readonly repositories: TransactionalRepositories;
  readonly clock: Clock;
}) => ({
  createPortfolio: createPortfolio({ unitOfWork: deps.unitOfWork }),
  updatePortfolio: updatePortfolio({ unitOfWork: deps.unitOfWork }),
  setPortfolioArchived: setPortfolioArchived({
    portfolios: deps.repositories.portfolios,
  }),
  deletePortfolio: deletePortfolio({ unitOfWork: deps.unitOfWork }),
  listPortfolios: listPortfolios({ portfolios: deps.repositories.portfolios }),
  getPortfolio: getPortfolio({ portfolios: deps.repositories.portfolios }),
  putStrategy: putStrategy({ unitOfWork: deps.unitOfWork }),
  listInstitutions: listInstitutions({ institutions: deps.repositories.institutions }),
  createInstitution: createInstitution({ unitOfWork: deps.unitOfWork }),
  updateInstitution: updateInstitution({ institutions: deps.repositories.institutions }),
  deleteInstitution: deleteInstitution({ unitOfWork: deps.unitOfWork }),
  getFgcExposure: getFgcExposure({ institutions: deps.repositories.institutions }),
  listCategories: listCategories({ categories: deps.repositories.categories }),
  createCategory: createCategory({ unitOfWork: deps.unitOfWork }),
  updateCategory: updateCategory({ unitOfWork: deps.unitOfWork }),
  deleteCategory: deleteCategory({ unitOfWork: deps.unitOfWork }),
  listAssets: listAssets({ assets: deps.repositories.assets }),
  getAsset: getAsset({ assets: deps.repositories.assets }),
  createAsset: createAsset({ unitOfWork: deps.unitOfWork }),
  createFixedIncomeAsset: createFixedIncomeAsset({ unitOfWork: deps.unitOfWork }),
  updateAsset: updateAsset({ unitOfWork: deps.unitOfWork }),
  archiveAsset: archiveAsset({ unitOfWork: deps.unitOfWork }),
  deleteAsset: deleteAsset({ unitOfWork: deps.unitOfWork }),
  setManualPrice: setManualPrice({ unitOfWork: deps.unitOfWork }),
  listManualPrices: listManualPrices({ manualPrices: deps.repositories.manualPrices }),
  deleteManualPrice: deleteManualPrice({ unitOfWork: deps.unitOfWork }),
  createTransaction: createTransaction({ unitOfWork: deps.unitOfWork }),
  createCashMovement: createCashMovement({ unitOfWork: deps.unitOfWork }),
  confirmPayout: confirmPayout({ unitOfWork: deps.unitOfWork, clock: deps.clock }),
  dismissPayout: dismissPayout({ unitOfWork: deps.unitOfWork }),
  createPayout: createPayout({
    unitOfWork: deps.unitOfWork,
    clock: deps.clock,
    jcpWithholdingPct: String(environment.tax.jcpWithholdingPct),
  }),
  previewPayout: previewPayout({
    unitOfWork: deps.unitOfWork,
    jcpWithholdingPct: String(environment.tax.jcpWithholdingPct),
  }),
  previewTransaction: previewTransaction({ unitOfWork: deps.unitOfWork }),
  listCorporateEvents: listCorporateEvents({
    corporateEvents: deps.repositories.corporateEvents,
  }),
  registerCorporateEvent: registerCorporateEvent({
    unitOfWork: deps.unitOfWork,
    clock: deps.clock,
  }),
  confirmCorporateEvent: confirmCorporateEvent({
    unitOfWork: deps.unitOfWork,
    clock: deps.clock,
  }),
  listTransactions: listTransactions({ transactions: deps.repositories.transactions }),
  getTransaction: getTransaction({ transactions: deps.repositories.transactions }),
  interpretTransaction: interpretTransaction({
    assets: deps.repositories.assets,
    clock: deps.clock,
  }),
  updateTransaction: updateTransaction({ unitOfWork: deps.unitOfWork }),
  previewUpdate: previewUpdate({ unitOfWork: deps.unitOfWork }),
  deleteTransaction: deleteTransaction({
    unitOfWork: deps.unitOfWork,
    clock: deps.clock,
    undoWindowSeconds: environment.ledger.undoWindowSeconds,
  }),
  undoDeletion: undoDeletion({
    unitOfWork: deps.unitOfWork,
    clock: deps.clock,
    undoWindowSeconds: environment.ledger.undoWindowSeconds,
  }),
  // A tela de dados de mercado só lê; a coleta é do worker. O "atualizar agora"
  // da api insere o evento na outbox e devolve na hora.
  getMarketHealth: getMarketHealth({
    unitOfWork: deps.unitOfWork,
    clock: deps.clock,
    ceilings: { brapi: BRAPI_FREE_MONTHLY_CEILING },
    staleAfterDays: environment.market.priceStaleAfterDays,
  }),
  refreshMarketData: refreshMarketData({
    unitOfWork: deps.unitOfWork,
    clock: deps.clock,
  }),
  getAssetPriceSeries: getAssetPriceSeries({ unitOfWork: deps.unitOfWork }),
  // T-02 lê fora da transação: a tela de Posições só consulta, e abrir uma
  // transação para duas leituras custaria uma conexão do pool a cada abertura.
  listPositions: listPositions({
    positionViews: deps.repositories.positionViews,
    clock: deps.clock,
  }),
  // T-03 lê fora da transação pela mesma razão.
  getAssetPage: getAssetPage({
    assetPages: deps.repositories.assetPages,
    clock: deps.clock,
  }),
  // T-04 também lê fora da transação: o extrato só consulta.
  getStatement: getStatement({ statements: deps.repositories.statements }),
  // T-09 lê fora da transação: a busca são duas consultas de leitura.
  searchGlobal: searchGlobal({ search: deps.repositories.search }),
  // A tela de abertura: uma rota, duas consultas — o instantâneo e os alertas.
  getOverview: getOverview({ unitOfWork: deps.unitOfWork, clock: deps.clock }),
  // T-05 lê fora da transação, como T-02 a T-04: são duas consultas de leitura.
  getPerformance: getPerformance({
    performance: deps.repositories.performance,
    clock: deps.clock,
  }),
  // T-06 também lê fora da transação: a estratégia é uma consulta de leitura.
  getAllocation: getAllocation({
    allocation: deps.repositories.allocation,
    clock: deps.clock,
  }),
  // T-07 também lê fora da transação: os objetivos são uma consulta de leitura.
  getGoals: getGoals({
    goals: deps.repositories.goals,
    clock: deps.clock,
  }),
  // T-08 lê fora da transação: o cadastro todo é uma consulta de leitura. O que é
  // do ambiente — janela do desfazer, alíquota do JCP, backup ligado — entra
  // aqui, e a tela o mostra como leitura.
  getSettings: getSettings({
    settings: deps.repositories.settings,
    undoWindowSeconds: environment.ledger.undoWindowSeconds,
    jcpWithholdingPct: environment.tax.jcpWithholdingPct,
    backupEnabled: environment.backup.enabled,
  }),
  requestBackup: requestBackup({
    unitOfWork: deps.unitOfWork,
    clock: deps.clock,
    backupEnabled: environment.backup.enabled,
  }),
});

export type ApiUseCases = ReturnType<typeof createApiUseCases>;

export type ApiContainer = {
  readonly sql: Sql;
  readonly redis: RedisConnection;
  readonly queues: Queues;
  readonly repositories: TransactionalRepositories;
  readonly unitOfWork: UnitOfWork;
  readonly usecases: ApiUseCases;
  readonly clock: Clock;
  readonly version: string;
  readonly startedAt: Date;
  readonly shutdown: () => Promise<void>;
};

export const createContainer = (version: string): ApiContainer => {
  const sql = createConnection({
    connection: environment.database.connection,
    // O pool da api e o do worker têm tamanhos diferentes: a api atende
    // request curto, o worker roda recálculo longo.
    poolSize: environment.database.poolApi,
    applicationName: 'patrimonio-api',
  });

  const redis = createRedisConnection(environment.redis.url);
  const queues = createQueues(redis);
  // A coalescência vale aqui também, e principalmente aqui: a rajada de pedidos
  // de recálculo nasce de cliques na tela, não do worker. Sem a espera, cinco
  // lançamentos seguidos na mesma carteira seriam cinco recálculos.
  const debounce = createDebouncePolicy(
    {
      waitMs: Math.min(
        environment.pipeline.relayPollMs * 2,
        environment.pipeline.debounceMaxMs,
      ),
      maxMs: environment.pipeline.debounceMaxMs,
    },
    () => systemClock.now(),
  );

  const repositories = createRepositories(sql, { debounce });
  const unitOfWork = createUnitOfWork(sql, { debounce });

  return {
    sql,
    redis,
    queues,
    repositories,
    unitOfWork,
    usecases: createApiUseCases({ unitOfWork, repositories, clock: systemClock }),
    clock: systemClock,
    version,
    startedAt: new Date(),
    shutdown: async () => {
      await closeQueues(queues);
      await closeRedisConnection(redis);
      await closeDatabase(sql);
    },
  };
};
