import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

export type Migration = {
  readonly name: string;
  readonly up: string;
  readonly down: string;
  readonly checksum: string;
};

export type AppliedMigration = {
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: Date;
  readonly duration_ms: number;
};

export type MigrationStatus = {
  readonly applied: readonly AppliedMigration[];
  readonly pending: readonly string[];
};

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const SCHEMA_TABLE = 'schema_migrations';

/**
 * As migrations moram em `src/migrations/{up,down}` e são lidas do disco, não
 * importadas: o container roda o runner compilado e precisa achar os mesmos
 * arquivos.
 */
const resolveDirectory = (override?: string): string => {
  if (override !== undefined) return override;

  const here = dirname(fileURLToPath(import.meta.url));
  // Em `src/migrations/runner.ts` a pasta é esta; em `dist/migrations/runner.js`
  // os .sql continuam em `src/migrations`, que é o que o repositório carrega.
  return here.includes(`${join('dist', 'migrations')}`)
    ? join(here, '..', '..', 'src', 'migrations')
    : here;
};

const checksumOf = (content: string): string =>
  createHash('sha256').update(content).digest('hex').slice(0, 32);

const sqlFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory);
  return entries.filter((entry) => entry.endsWith('.sql')).sort();
};

/**
 * Carrega os pares. Um `up/` sem par de mesmo nome em `down/` é recusado: sem
 * isso, descobrir que não há volta acontece no pior momento possível.
 */
export const loadMigrations = async (override?: string): Promise<Migration[]> => {
  const directory = resolveDirectory(override);
  const ups = await sqlFiles(join(directory, 'up'));
  const downs = new Set(await sqlFiles(join(directory, 'down')));

  const migrations: Migration[] = [];

  for (const file of ups) {
    if (!downs.has(file)) {
      throw new MigrationError(`up/${file} não tem par em down/`);
    }

    const [up, down] = await Promise.all([
      readFile(join(directory, 'up', file), 'utf8'),
      readFile(join(directory, 'down', file), 'utf8'),
    ]);

    migrations.push({
      name: file.replace(/\.sql$/, ''),
      up,
      down,
      checksum: checksumOf(up),
    });
  }

  const orphans = [...downs].filter((file) => !ups.includes(file));
  if (orphans.length > 0) {
    throw new MigrationError(`down/ sem par em up/: ${orphans.join(', ')}`);
  }

  return migrations;
};

const connect = (connection: string): postgres.Sql<Record<string, never>> =>
  postgres(connection, { max: 1, prepare: false, onnotice: () => {} });

const ensureSchemaTable = async (
  sql: postgres.Sql<Record<string, never>>,
): Promise<void> => {
  await sql`
    create table if not exists ${sql(SCHEMA_TABLE)} (
      name        text        primary key,
      checksum    text        not null,
      applied_at  timestamptz not null default now(),
      duration_ms integer     not null
    )
  `;
};

const listApplied = async (
  sql: postgres.Sql<Record<string, never>>,
): Promise<AppliedMigration[]> => {
  const rows = await sql<AppliedMigration[]>`
    select name, checksum, applied_at, duration_ms
      from ${sql(SCHEMA_TABLE)}
     order by name
  `;

  return [...rows];
};

/**
 * Migration aplicada nunca é editada: nova migration, sempre. O checksum é o
 * que transforma essa regra em verificação, em vez de combinado.
 */
const assertUnchanged = (
  migrations: readonly Migration[],
  applied: readonly AppliedMigration[],
): void => {
  const byName = new Map(migrations.map((migration) => [migration.name, migration]));

  for (const row of applied) {
    const migration = byName.get(row.name);
    if (migration === undefined) {
      throw new MigrationError(
        `${row.name} está aplicada no banco e não existe mais em up/`,
      );
    }

    if (migration.checksum !== row.checksum) {
      throw new MigrationError(
        `${row.name} mudou de conteúdo depois de aplicada ` +
          `(banco: ${row.checksum}, arquivo: ${migration.checksum})`,
      );
    }
  }
};

export type RunResult = { readonly applied: readonly string[] };

/** Aplica o que falta, cada migration na sua transação. */
export const runMigrations = async (
  connection: string,
  options?: { readonly directory?: string; readonly log?: (line: string) => void },
): Promise<RunResult> => {
  const sql = connect(connection);

  try {
    const migrations = await loadMigrations(options?.directory);
    await ensureSchemaTable(sql);
    const applied = await listApplied(sql);
    assertUnchanged(migrations, applied);

    const done = new Set(applied.map((row) => row.name));
    const pending = migrations.filter((migration) => !done.has(migration.name));
    const names: string[] = [];

    for (const migration of pending) {
      const started = Date.now();

      await sql.begin(async (tx) => {
        // Duas subidas simultâneas não aplicam a mesma migration.
        await tx`select pg_advisory_xact_lock(hashtextextended('patrimonio:migrate', 0))`;
        await tx.unsafe(migration.up);
        const duration = Date.now() - started;
        await tx`
          insert into ${tx(SCHEMA_TABLE)} (name, checksum, duration_ms)
          values (${migration.name}, ${migration.checksum}, ${duration})
        `;
      });

      names.push(migration.name);
      options?.log?.(`aplicada ${migration.name} (${Date.now() - started} ms)`);
    }

    return { applied: names };
  } finally {
    await sql.end({ timeout: 5 });
  }
};

/** Desfaz as `steps` últimas, da mais recente para a mais antiga. */
export const rollbackMigrations = async (
  connection: string,
  steps = 1,
  options?: { readonly directory?: string; readonly log?: (line: string) => void },
): Promise<RunResult> => {
  const sql = connect(connection);

  try {
    const migrations = await loadMigrations(options?.directory);
    await ensureSchemaTable(sql);
    const applied = await listApplied(sql);
    assertUnchanged(migrations, applied);

    const byName = new Map(migrations.map((migration) => [migration.name, migration]));
    const target = [...applied].reverse().slice(0, steps);
    const names: string[] = [];

    for (const row of target) {
      const migration = byName.get(row.name);
      if (migration === undefined) {
        throw new MigrationError(`${row.name} não tem arquivo para desfazer`);
      }

      const started = Date.now();

      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended('patrimonio:migrate', 0))`;
        await tx.unsafe(migration.down);
        await tx`delete from ${tx(SCHEMA_TABLE)} where name = ${migration.name}`;
      });

      names.push(migration.name);
      options?.log?.(`desfeita ${migration.name} (${Date.now() - started} ms)`);
    }

    return { applied: names };
  } finally {
    await sql.end({ timeout: 5 });
  }
};

export const migrationStatus = async (
  connection: string,
  options?: { readonly directory?: string },
): Promise<MigrationStatus> => {
  const sql = connect(connection);

  try {
    const migrations = await loadMigrations(options?.directory);
    await ensureSchemaTable(sql);
    const applied = await listApplied(sql);
    const done = new Set(applied.map((row) => row.name));

    return {
      applied,
      pending: migrations
        .filter((migration) => !done.has(migration.name))
        .map((migration) => migration.name),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
};
