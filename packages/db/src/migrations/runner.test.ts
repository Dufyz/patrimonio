import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConnection, closeDatabase } from '../postgresql.js';
import type { Sql } from '../postgresql.js';
import { createScratchDatabase, withScratchDatabase } from '../testing/database.js';
import type { ScratchDatabase } from '../testing/database.js';
import {
  MigrationError,
  loadMigrations,
  migrationStatus,
  rollbackMigrations,
  runMigrations,
} from './runner.js';

const pairDirectory = async (
  pairs: ReadonlyArray<{ name: string; up: string; down?: string }>,
): Promise<string> => {
  const base = await mkdtemp(join(tmpdir(), 'patrimonio-migrations-'));
  await mkdir(join(base, 'up'));
  await mkdir(join(base, 'down'));

  for (const pair of pairs) {
    await writeFile(join(base, 'up', `${pair.name}.sql`), pair.up);
    if (pair.down !== undefined) {
      await writeFile(join(base, 'down', `${pair.name}.sql`), pair.down);
    }
  }

  return base;
};

describe('carregamento das migrations', () => {
  it('recusa um up/ sem par de mesmo nome em down/', async () => {
    const directory = await pairDirectory([
      { name: '001_cria_tabela', up: 'CREATE TABLE t (id INT);' },
    ]);

    await expect(loadMigrations(directory)).rejects.toThrow(/não tem par em down/);
  });

  it('recusa um down/ sem par em up/', async () => {
    const directory = await pairDirectory([
      { name: '001_cria_tabela', up: 'CREATE TABLE t (id INT);', down: 'DROP TABLE t;' },
    ]);
    await writeFile(join(directory, 'down', '002_sozinho.sql'), 'DROP TABLE nada;');

    await expect(loadMigrations(directory)).rejects.toThrow(/sem par em up/);
  });

  it('carrega os pares em ordem de nome, com checksum', async () => {
    const directory = await pairDirectory([
      { name: '002_segunda', up: 'SELECT 2;', down: 'SELECT -2;' },
      { name: '001_primeira', up: 'SELECT 1;', down: 'SELECT -1;' },
    ]);

    const migrations = await loadMigrations(directory);

    expect(migrations.map((migration) => migration.name)).toEqual([
      '001_primeira',
      '002_segunda',
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[0-9a-f]{32}$/);
  });

  it('as migrations do projeto têm todas o seu par', async () => {
    const migrations = await loadMigrations();

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]?.name).toBe('001_enable_unaccent');
  });
});

describe('aplicação das migrations', () => {
  it('migration já aplicada que mudou de conteúdo falha', async () => {
    await withScratchDatabase(async (connection) => {
      const first = await pairDirectory([
        { name: '001_t', up: 'CREATE TABLE t (id INT);', down: 'DROP TABLE t;' },
      ]);

      await runMigrations(connection, { directory: first });

      const changed = await pairDirectory([
        {
          name: '001_t',
          up: 'CREATE TABLE t (id INT, extra TEXT);',
          down: 'DROP TABLE t;',
        },
      ]);

      await expect(runMigrations(connection, { directory: changed })).rejects.toThrow(
        MigrationError,
      );
      await expect(runMigrations(connection, { directory: changed })).rejects.toThrow(
        /mudou de conteúdo depois de aplicada/,
      );
    });
  });

  it('cada direção roda em transação: migration que falha no meio não grava nada', async () => {
    await withScratchDatabase(async (connection) => {
      const directory = await pairDirectory([
        {
          name: '001_meia_falha',
          up: 'CREATE TABLE a (id INT); CREATE TABLE a (id INT);',
          down: 'DROP TABLE IF EXISTS a;',
        },
      ]);

      await expect(runMigrations(connection, { directory })).rejects.toThrow();

      const sql = createConnection({
        connection,
        poolSize: 1,
        applicationName: 'patrimonio-test',
      });

      try {
        const [row] = await sql<{ exists: boolean }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'a') AS EXISTS
        `;
        expect(row?.exists).toBe(false);

        const status = await migrationStatus(connection, { directory });
        expect(status.applied).toHaveLength(0);
      } finally {
        await closeDatabase(sql);
      }
    });
  });

  it('status lista aplicadas e pendentes em ordem', async () => {
    await withScratchDatabase(async (connection) => {
      const directory = await pairDirectory([
        { name: '001_a', up: 'CREATE TABLE a (id INT);', down: 'DROP TABLE a;' },
        { name: '002_b', up: 'CREATE TABLE b (id INT);', down: 'DROP TABLE b;' },
      ]);

      await runMigrations(connection, { directory });
      const afterUp = await migrationStatus(connection, { directory });

      expect(afterUp.applied.map((row) => row.name)).toEqual(['001_a', '002_b']);
      expect(afterUp.pending).toEqual([]);

      await rollbackMigrations(connection, 1, { directory });
      const afterDown = await migrationStatus(connection, { directory });

      expect(afterDown.applied.map((row) => row.name)).toEqual(['001_a']);
      expect(afterDown.pending).toEqual(['002_b']);
    });
  });
});

describe('o schema do projeto', () => {
  // Um banco limpo só para este arquivo: ele aplica e desfaz o schema inteiro.
  let scratch: ScratchDatabase;
  let connection: string;
  let sql: Sql;

  beforeAll(async () => {
    scratch = await createScratchDatabase();
    connection = scratch.connection;
    sql = createConnection({
      connection,
      poolSize: 2,
      applicationName: 'patrimonio-test-schema',
    });
  });

  afterAll(async () => {
    await closeDatabase(sql);
    await scratch.drop();
  });

  it('roda num banco vazio e duas vezes seguidas sem erro', async () => {
    const first = await runMigrations(connection);
    expect(first.applied.length).toBeGreaterThanOrEqual(23);

    const second = await runMigrations(connection);
    expect(second.applied).toEqual([]);
  });

  it('position_daily nasce particionada por ano', async () => {
    const [parent] = await sql<{ relkind: string }[]>`
      SELECT relkind::TEXT FROM pg_class WHERE relname = 'position_daily'
    `;
    expect(parent?.relkind).toBe('p');

    const [strategy] = await sql<{ strategy: string }[]>`
      SELECT partstrat::TEXT AS strategy
        FROM pg_partitioned_table
        JOIN pg_class ON pg_class.oid = pg_partitioned_table.partrelid
       WHERE relname = 'position_daily'
    `;
    // 'r' é range: a partição é por intervalo de position_date.
    expect(strategy?.strategy).toBe('r');

    const [partitions] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total
        FROM pg_inherits
        JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
       WHERE parent.relname = 'position_daily'
    `;
    expect(Number(partitions?.total)).toBe(36);
  });

  it('todo valor monetário é NUMERIC com a escala do documento de entidades', async () => {
    const rows = await sql<{ table_name: string; column_name: string; scale: number }[]>`
      SELECT table_name::TEXT, column_name::TEXT, numeric_scale AS scale
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type = 'numeric'
       ORDER BY table_name, column_name
    `;

    const scaleOf = (table: string, column: string): number | undefined =>
      rows.find((row) => row.table_name === table && row.column_name === column)?.scale;

    expect(scaleOf('transaction', 'quantity')).toBe(8);
    expect(scaleOf('transaction', 'unit_price')).toBe(8);
    expect(scaleOf('transaction', 'net_amount')).toBe(2);
    expect(scaleOf('asset', 'rate')).toBe(8);
    expect(scaleOf('index_quote', 'daily_factor')).toBe(12);
    expect(scaleOf('portfolio_daily', 'quota_value')).toBe(12);
    expect(scaleOf('position_daily', 'market_value')).toBe(2);

    // Nunca double precision, nunca float.
    const [floats] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type IN ('double precision', 'real')
    `;
    expect(Number(floats?.total)).toBe(0);
  });

  it('toda tabela de cadastro tem created_at e updated_at', async () => {
    const cadastro = [
      'portfolio',
      'institution',
      'category',
      'asset',
      'transaction',
      'strategy_target',
      'goal',
      'alert_rule',
      'benchmark',
      'announced_payout',
      'corporate_event',
    ];

    const rows = await sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name::TEXT, column_name::TEXT
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name IN ('created_at', 'updated_at')
    `;

    for (const table of cadastro) {
      const columns = rows
        .filter((row) => row.table_name === table)
        .map((row) => row.column_name)
        .sort();

      expect(columns, table).toEqual(['created_at', 'updated_at']);
    }
  });

  it('tabela de ingestão e de projeção não têm updated_at', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name::TEXT
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name = 'updated_at'
         AND table_name IN (
           'asset_price', 'index_quote', 'position_daily',
           'portfolio_daily', 'realized_result', 'tax_month'
         )
    `;

    expect(rows).toEqual([]);
  });

  it('um UPDATE sem tocar em updated_at ainda atualiza a coluna', async () => {
    await sql`
      INSERT INTO institution (id, name, role)
      VALUES ('0191e5a0-0000-7000-8000-00000000f001', 'Corretora de Teste', 'custodian')
    `;

    const [before] = await sql<{ updated_at: Date }[]>`
      SELECT updated_at FROM institution
       WHERE id = '0191e5a0-0000-7000-8000-00000000f001'
    `;

    await new Promise((resolve) => setTimeout(resolve, 15));

    await sql`
      UPDATE institution SET name = 'Corretora Renomeada'
       WHERE id = '0191e5a0-0000-7000-8000-00000000f001'
    `;

    const [after] = await sql<{ updated_at: Date }[]>`
      SELECT updated_at FROM institution
       WHERE id = '0191e5a0-0000-7000-8000-00000000f001'
    `;

    expect(after?.updated_at.getTime()).toBeGreaterThan(before!.updated_at.getTime());
  });

  it('o down de cada migration reverte sem deixar tipo nem função órfãos', async () => {
    const applied = (await migrationStatus(connection)).applied.length;
    await rollbackMigrations(connection, applied);

    const [tables] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname <> 'schema_migrations'
    `;
    const [types] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typtype = 'e'
    `;
    const [functions] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
    `;

    expect(Number(tables?.total)).toBe(0);
    expect(Number(types?.total)).toBe(0);
    expect(Number(functions?.total)).toBe(0);
  });
});
