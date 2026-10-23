import { environment } from '@patrimonio/env';

import { closeDatabase, createConnection } from '../postgresql.js';
import { removeDemoData } from '../seeds/remove_demo.js';

/**
 * `pnpm demo:remove [--test]`
 *
 * Apaga os dados de demonstração do `dev_seed.sql` e deixa os lançamentos reais
 * como estão. Repetível: sem demonstração, não há o que apagar.
 */
const useTest = process.argv.slice(2).includes('--test');
const connection = useTest
  ? environment.database.testConnection
  : environment.database.connection;

if (connection === undefined) {
  process.stderr.write('DB_TEST_CONNECTION não está definida\n');
  process.exit(1);
}

const sql = createConnection({
  connection,
  poolSize: 1,
  applicationName: 'patrimonio-demo-remove',
});

try {
  const removed = await removeDemoData(sql);

  process.stdout.write(
    `demonstração removida: ${removed.portfolios} carteiras, ${removed.transactions} lançamentos, ` +
      `${removed.assets} ativos, ${removed.institutions} instituições\n`,
  );
  if (removed.kept_assets > 0 || removed.kept_institutions > 0) {
    process.stdout.write(
      `mantidos, porque lançamentos reais os usam: ${removed.kept_assets} ativos, ` +
        `${removed.kept_institutions} instituições\n`,
    );
  }
} finally {
  await closeDatabase(sql);
}
