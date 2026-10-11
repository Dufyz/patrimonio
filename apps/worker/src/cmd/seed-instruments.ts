import { refreshInstrumentCatalog } from '@patrimonio/application';
import { closeDatabase, createConnection, createUnitOfWork } from '@patrimonio/db';
import { toDateOnly } from '@patrimonio/domain';
import { environment } from '@patrimonio/env';

import { createInstrumentCatalogSource } from '../infra/cotahist.js';

/**
 * `pnpm seed:instruments [--arquivo=<caminho|url>] [--ano=AAAA] [--test]`
 *
 * Carrega o catálogo de papéis (ações, units, FIIs, ETFs e BDRs) a partir do
 * COTAHIST da B3. Sem argumentos, baixa o arquivo do ano corrente — e, nos
 * primeiros dias de janeiro, o do anterior. `--arquivo` aceita o ZIP ou o TXT já
 * baixado, no disco ou por endereço.
 *
 * Repetível: o que já existe é atualizado, e o que o arquivo não trouxe mais
 * fica inativo, nunca apagado.
 */
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const connection = argv.includes('--test')
  ? environment.database.testConnection
  : environment.database.connection;

if (connection === undefined) {
  process.stderr.write('DB_TEST_CONNECTION não está definida\n');
  process.exit(1);
}

const sql = createConnection({
  connection,
  poolSize: 2,
  applicationName: 'patrimonio-seed',
});

const clock = {
  now: () => new Date(),
  today: () => toDateOnly(new Date()),
};

const year =
  flag('ano') === undefined ? clock.today().slice(0, 4) : (flag('ano') as string);

try {
  const result = await refreshInstrumentCatalog({
    unitOfWork: createUnitOfWork(sql),
    clock,
    instruments: createInstrumentCatalogSource({
      year: () => Number(year),
      location: flag('arquivo'),
    }),
  })({ force: true });

  if (result.isFailure()) {
    process.stderr.write(`catálogo de papéis: ${result.value.message}\n`);
    process.exitCode = 1;
  } else {
    const done = result.value;
    write(
      `papéis: ${done.lines_read} linhas lidas até ${done.last_date ?? 's/d'}, ` +
        `${done.created} novos, ${done.updated} atualizados, ${done.deactivated} inativos`,
    );
  }
} finally {
  await closeDatabase(sql);
}
