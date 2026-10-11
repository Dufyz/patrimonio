import { loadPriceHistory } from '@patrimonio/application';
import { closeDatabase, createConnection, createUnitOfWork } from '@patrimonio/db';
import { toDateOnly } from '@patrimonio/domain';
import { environment } from '@patrimonio/env';

import { createPriceHistorySource } from '../infra/cotahist.js';

/**
 * `pnpm seed:cotahist --ano=2024 | --de=2016 --ate=2026 [--papeis=ITUB4,VALE3]
 *  [--arquivo=<caminho|url>] [--test]`
 *
 * Carrega o histórico de fechamentos dos arquivos anuais do COTAHIST. Sem
 * `--papeis`, grava os ativos de mercado já cadastrados; sem ano, o corrente.
 * `--arquivo` aponta o arquivo (ZIP ou TXT) de um ano só.
 *
 * Repetível: a chave é (ativo, data), então reimportar um ano não duplica linha.
 * O preço é o negociado na data, sem ajuste por evento corporativo.
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

const currentYear = Number(clock.today().slice(0, 4));

const yearOf = (name: string, fallback: number): number => {
  const raw = flag(name);
  if (raw === undefined) return fallback;

  const year = Number(raw);
  if (!Number.isInteger(year) || year < 1986 || year > currentYear) {
    return fail(`--${name}=${raw} não é um ano entre 1986 e ${currentYear}`);
  }

  return year;
};

const single = flag('ano');
const fromYear =
  single === undefined ? yearOf('de', currentYear) : yearOf('ano', currentYear);
const toYear = single === undefined ? yearOf('ate', currentYear) : fromYear;
const location = flag('arquivo');

if (location !== undefined && fromYear !== toYear) {
  fail('--arquivo vale para um ano só: use --ano=AAAA');
}

const tickers = (flag('papeis') ?? '')
  .split(',')
  .map((ticker) => ticker.trim().toUpperCase())
  .filter((ticker) => ticker !== '');

const sql = createConnection({
  connection: connection as string,
  poolSize: 2,
  applicationName: 'patrimonio-seed',
});

try {
  const result = await loadPriceHistory({
    unitOfWork: createUnitOfWork(sql),
    clock,
    history: createPriceHistorySource({
      currentYear: () => currentYear,
      ...(location === undefined ? {} : { locationFor: () => location }),
    }),
  })({ from_year: fromYear, to_year: toYear, tickers });

  if (result.isFailure()) {
    process.stderr.write(`histórico de preços: ${result.value.message}\n`);
    process.exitCode = 1;
  } else {
    const done = result.value;
    write(
      `histórico ${fromYear}-${toYear}: ${done.assets} ativos, ` +
        `${done.lines_read} linhas lidas, ${done.records_kept} mantidas, ` +
        `${done.prices_written} preços gravados`,
    );
    if (done.missing.length > 0) {
      write(`ausentes (sem ativo cadastrado ou sem cotação): ${done.missing.join(', ')}`);
    }
    if (done.unavailable_years.length > 0) {
      write(`arquivos ainda não publicados: ${done.unavailable_years.join(', ')}`);
    }
  }
} finally {
  await closeDatabase(sql);
}
