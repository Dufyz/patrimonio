import { loadTreasuryCatalog } from '@patrimonio/application';
import { closeDatabase, createConnection, createUnitOfWork } from '@patrimonio/db';
import { toDateOnly } from '@patrimonio/domain';
import { environment } from '@patrimonio/env';

import { createMarketSources } from '../infra/market.js';

/**
 * `pnpm seed:tesouro [--test]`
 *
 * Carrega o catálogo do Tesouro Direto: os títulos à venda hoje, pela mesma
 * cadeia de fontes da coleta diária. Repetível: o título que saiu da tabela fica
 * inativo, nunca apagado.
 */
const argv = process.argv.slice(2);

const connection = argv.includes('--test')
  ? environment.database.testConnection
  : environment.database.connection;

if (connection === undefined) {
  process.stderr.write('DB_TEST_CONNECTION não está definida\n');
  process.exit(1);
}

const clock = {
  now: () => new Date(),
  today: () => toDateOnly(new Date()),
};

const sql = createConnection({
  connection,
  poolSize: 2,
  applicationName: 'patrimonio-seed',
});

try {
  const sources = createMarketSources({ year: () => Number(clock.today().slice(0, 4)) });

  const result = await loadTreasuryCatalog({
    unitOfWork: createUnitOfWork(sql),
    clock,
    treasury: sources.treasury,
  })();

  if (result.isFailure()) {
    process.stderr.write(`catálogo do Tesouro: ${result.value.message}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Tesouro: ${result.value.titles} títulos à venda, fonte ${result.value.source}\n`,
    );
  }
} finally {
  await closeDatabase(sql);
}
