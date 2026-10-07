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
      { name: '001_cria_tabela', up: 'create table t (id int);' },
    ]);

    await expect(loadMigrations(directory)).rejects.toThrow(/não tem par em down/);
  });

  it('recusa um down/ sem par em up/', async () => {
    const directory = await pairDirectory([
      { name: '001_cria_tabela', up: 'create table t (id int);', down: 'drop table t;' },
    ]);
    await writeFile(join(directory, 'down', '002_sozinho.sql'), 'drop table nada;');

    await expect(loadMigrations(directory)).rejects.toThrow(/sem par em up/);
  });

  it('carrega os pares em ordem de nome, com checksum', async () => {
    const directory = await pairDirectory([
      { name: '002_segunda', up: 'select 2;', down: 'select -2;' },
      { name: '001_primeira', up: 'select 1;', down: 'select -1;' },
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
    expect(migrations[0]?.name).toBe('001_create_function_set_updated_at');
  });
});

describe('aplicação das migrations', () => {
  it('migration já aplicada que mudou de conteúdo falha', async () => {
    await withScratchDatabase(async (connection) => {
      const first = await pairDirectory([
        { name: '001_t', up: 'create table t (id int);', down: 'drop table t;' },
      ]);

      await runMigrations(connection, { directory: first });

      const changed = await pairDirectory([
        {
          name: '001_t',
          up: 'create table t (id int, extra text);',
          down: 'drop table t;',
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
          up: 'create table a (id int); create table a (id int);',
          down: 'drop table if exists a;',
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
          select exists (select 1 from pg_tables where tablename = 'a') as exists
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
        { name: '001_a', up: 'create table a (id int);', down: 'drop table a;' },
        { name: '002_b', up: 'create table b (id int);', down: 'drop table b;' },
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
      select relkind::text from pg_class where relname = 'position_daily'
    `;
    expect(parent?.relkind).toBe('p');

    const [strategy] = await sql<{ strategy: string }[]>`
      select partstrat::text as strategy
        from pg_partitioned_table
        join pg_class on pg_class.oid = pg_partitioned_table.partrelid
       where relname = 'position_daily'
    `;
    // 'r' é range: a partição é por intervalo de position_date.
    expect(strategy?.strategy).toBe('r');

    const [partitions] = await sql<{ total: string }[]>`
      select count(*)::text as total
        from pg_inherits
        join pg_class parent on parent.oid = pg_inherits.inhparent
       where parent.relname = 'position_daily'
    `;
    expect(Number(partitions?.total)).toBe(36);
  });

  it('todo valor monetário é NUMERIC com a escala do documento de entidades', async () => {
    const rows = await sql<{ table_name: string; column_name: string; scale: number }[]>`
      select table_name::text, column_name::text, numeric_scale as scale
        from information_schema.columns
       where table_schema = 'public'
         and data_type = 'numeric'
       order by table_name, column_name
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
      select count(*)::text as total
        from information_schema.columns
       where table_schema = 'public'
         and data_type in ('double precision', 'real')
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
      select table_name::text, column_name::text
        from information_schema.columns
       where table_schema = 'public'
         and column_name in ('created_at', 'updated_at')
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
      select table_name::text
        from information_schema.columns
       where table_schema = 'public'
         and column_name = 'updated_at'
         and table_name in (
           'asset_price', 'index_quote', 'position_daily',
           'portfolio_daily', 'realized_result', 'tax_month'
         )
    `;

    expect(rows).toEqual([]);
  });

  it('um UPDATE sem tocar em updated_at ainda atualiza a coluna', async () => {
    await sql`
      insert into institution (id, name, role)
      values ('0191e5a0-0000-7000-8000-00000000f001', 'Corretora de Teste', 'custodian')
    `;

    const [before] = await sql<{ updated_at: Date }[]>`
      select updated_at from institution
       where id = '0191e5a0-0000-7000-8000-00000000f001'
    `;

    await new Promise((resolve) => setTimeout(resolve, 15));

    await sql`
      update institution set name = 'Corretora Renomeada'
       where id = '0191e5a0-0000-7000-8000-00000000f001'
    `;

    const [after] = await sql<{ updated_at: Date }[]>`
      select updated_at from institution
       where id = '0191e5a0-0000-7000-8000-00000000f001'
    `;

    expect(after?.updated_at.getTime()).toBeGreaterThan(before!.updated_at.getTime());
  });

  it('o down de cada migration reverte sem deixar tipo nem função órfãos', async () => {
    const applied = (await migrationStatus(connection)).applied.length;
    await rollbackMigrations(connection, applied);

    const [tables] = await sql<{ total: string }[]>`
      select count(*)::text as total
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('r', 'p')
         and c.relname <> 'schema_migrations'
    `;
    const [types] = await sql<{ total: string }[]>`
      select count(*)::text as total
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typtype = 'e'
    `;
    const [functions] = await sql<{ total: string }[]>`
      select count(*)::text as total
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
    `;

    expect(Number(tables?.total)).toBe(0);
    expect(Number(types?.total)).toBe(0);
    expect(Number(functions?.total)).toBe(0);
  });
});
