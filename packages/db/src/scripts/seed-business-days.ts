import { environment } from '@patrimonio/env';

import { createConnection, closeDatabase } from '../postgresql.js';
import { loadBusinessDays } from '../seeds/load_business_days.js';

/** `pnpm seed:business-days [--test]` — idempotente, reescreve o calendário. */
const argv = process.argv.slice(2);
const useTest = argv.includes('--test');
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
  applicationName: 'patrimonio-seed',
});

try {
  const { rows, years } = await loadBusinessDays(sql);
  process.stdout.write(`calendário carregado: ${rows} dias, ${years}\n`);
} finally {
  await closeDatabase(sql);
}
