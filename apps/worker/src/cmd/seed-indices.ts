import { loadIndexHistory } from '@patrimonio/application';
import { closeDatabase, createConnection, createUnitOfWork } from '@patrimonio/db';
import { isDateOnly, toDateOnly } from '@patrimonio/domain';
import { environment } from '@patrimonio/env';

import { createMarketSources } from '../infra/market.js';

/**
 * `pnpm seed:indices [--desde=AAAA-MM-DD] [--test]`
 *
 * Carrega o histórico de CDI, Selic, IPCA, IBOV e IFIX. Sem `--desde`, parte do
 * primeiro lançamento da instalação. Repetível: a chave é (índice, data).
 * Ao terminar, pede o recálculo das carteiras desde a data inicial.
 */
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const connection = argv.includes('--test')
  ? environment.database.testConnection
  : environment.database.connection;

if (connection === undefined) fail('DB_TEST_CONNECTION não está definida');

const clock = {
  now: () => new Date(),
  today: () => toDateOnly(new Date()),
};

const raw = flag('desde');
const since = raw === undefined ? undefined : isDateOnly(raw) ? raw : undefined;
if (raw !== undefined && since === undefined) {
  fail(`--desde=${raw} não é uma data AAAA-MM-DD`);
}

const sql = createConnection({
  connection: connection as string,
  poolSize: 2,
  applicationName: 'patrimonio-seed',
});

try {
  const sources = createMarketSources({ year: () => Number(clock.today().slice(0, 4)) });

  const result = await loadIndexHistory({
    unitOfWork: createUnitOfWork(sql),
    clock,
    indices: sources.indices,
  })({ from: since });

  if (result.isFailure()) {
    process.stderr.write(`histórico de índices: ${result.value.message}\n`);
    process.exitCode = 1;
  } else {
    const done = result.value;
    write(`índices de ${done.from} a ${done.to}`);
    for (const [code, count] of Object.entries(done.written)) {
      write(`  ${code}: ${count} dias`);
    }
    if (done.empty.length > 0) {
      write(`sem série em nenhuma fonte: ${done.empty.join(', ')}`);
    }
    for (const [code, reason] of Object.entries(done.failed)) {
      write(`sem dados de ${code}: ${reason}`);
    }
    write(`recálculo pedido para ${done.recalculated.length} carteira(s)`);
  }
} finally {
  await closeDatabase(sql);
}
