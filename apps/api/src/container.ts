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
  dismissPayout,
  deleteCategory,
  deleteInstitution,
  deletePortfolio,
  getAsset,
  getTransaction,
  getFgcExposure,
  getPortfolio,
  listAssets,
  listTransactions,
  listCategories,
  listCorporateEvents,
  listInstitutions,
  listPortfolios,
  putStrategy,
  setPortfolioArchived,
  previewTransaction,
  previewTransfer,
  registerCorporateEvent,
  transferPosition,
  updateAsset,
  updateCategory,
  updateInstitution,
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
  createTransaction: createTransaction({ unitOfWork: deps.unitOfWork }),
  createCashMovement: createCashMovement({ unitOfWork: deps.unitOfWork }),
  confirmPayout: confirmPayout({ unitOfWork: deps.unitOfWork, clock: deps.clock }),
  dismissPayout: dismissPayout({ unitOfWork: deps.unitOfWork }),
  createPayout: createPayout({
    unitOfWork: deps.unitOfWork,
    clock: deps.clock,
    jcpWithholdingPct: String(environment.tax.jcpWithholdingPct),
  }),
  previewTransaction: previewTransaction({ unitOfWork: deps.unitOfWork }),
  transferPosition: transferPosition({ unitOfWork: deps.unitOfWork }),
  previewTransfer: previewTransfer({ unitOfWork: deps.unitOfWork }),
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
  const repositories = createRepositories(sql);
  const unitOfWork = createUnitOfWork(sql);

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
