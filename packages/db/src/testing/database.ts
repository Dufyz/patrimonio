import type { TransactionalRepositories } from '@patrimonio/application';
import type postgres from 'postgres';

import { runMigrations } from '../migrations/runner.js';
import { createConnection } from '../postgresql.js';
import type { Connection, CustomTypes, Sql } from '../postgresql.js';
import { loadBusinessDays } from '../seeds/load_business_days.js';
import { createRepositories } from '../unit-of-work.js';

/**
 * Nada de mock de banco: repositório, `apply` e rota rodam contra Postgres
 * real. Mock de repositório prova que o código chama o método certo, não que a
 * consulta devolve o número certo — e é a consulta que erra.
 */
export const testConnectionString = (): string => {
  const connection = process.env['DB_TEST_CONNECTION'];

  if (connection === undefined || connection === '') {
    throw new Error(
      'DB_TEST_CONNECTION não está definida: suba o ambiente com `pnpm infra:up`',
    );
  }

  return connection;
};

export const createTestConnection = (): Sql =>
  createConnection({
    connection: testConnectionString(),
    poolSize: 4,
    applicationName: 'patrimonio-test',
  });

/** Migrations aplicadas uma vez por execução da suíte, com o calendário carregado. */
export const prepareTestDatabase = async (sql: Sql): Promise<void> => {
  await runMigrations(testConnectionString());

  const [existing] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::TEXT AS total FROM business_day
  `;

  if (Number(existing?.total ?? 0) === 0) await loadBusinessDays(sql);
};

export type TestTransaction = postgres.ReservedSql<CustomTypes>;

/**
 * Cada teste roda dentro de uma transação que sofre `ROLLBACK` no final, sobre
 * uma conexão reservada — é o que permite a suíte inteira compartilhar um banco
 * sem um teste enxergar a escrita do outro.
 */
export const beginTestTransaction = async (sql: Sql): Promise<TestTransaction> => {
  const reserved = await sql.reserve();
  await reserved.unsafe('BEGIN');
  return reserved;
};

export const rollbackTestTransaction = async (tx: TestTransaction): Promise<void> => {
  await tx.unsafe('ROLLBACK');
  tx.release();
};

export const repositoriesOn = (tx: Connection): TransactionalRepositories =>
  createRepositories(tx);

export type ScratchDatabase = {
  readonly connection: string;
  readonly drop: () => Promise<void>;
};

/**
 * Um banco descartável, para o teste que precisa aplicar e desfazer migrations
 * sem atravessar o caminho das outras suítes.
 */
export const createScratchDatabase = async (): Promise<ScratchDatabase> => {
  const base = testConnectionString();
  const name = `patrimonio_scratch_${Date.now().toString(36)}${Math.floor(
    Math.random() * 1e4,
  )}`;
  const admin = createConnection({
    connection: base,
    poolSize: 1,
    applicationName: 'patrimonio-test-admin',
  });

  await admin.unsafe(`CREATE DATABASE ${name}`);

  const url = new URL(base);
  url.pathname = `/${name}`;

  return {
    connection: url.toString(),
    drop: async () => {
      try {
        await admin.unsafe(
          `SELECT PG_TERMINATE_BACKEND(pid) FROM pg_stat_activity WHERE datname = '${name}'`,
        );
        await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await admin.end({ timeout: 5 });
      }
    },
  };
};

export const withScratchDatabase = async <T>(
  work: (connection: string) => Promise<T>,
): Promise<T> => {
  const scratch = await createScratchDatabase();

  try {
    return await work(scratch.connection);
  } finally {
    await scratch.drop();
  }
};
