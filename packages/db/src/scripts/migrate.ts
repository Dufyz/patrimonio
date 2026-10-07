import { environment } from '@patrimonio/env';

import {
  MigrationError,
  migrationStatus,
  rollbackMigrations,
  runMigrations,
} from '../migrations/runner.js';

/**
 * `pnpm migrate up`, `pnpm migrate down [n]`, `pnpm migrate status`.
 * `--test` aponta para `DB_TEST_CONNECTION`, a porta separada do compose.
 */
const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const resolveConnection = (useTest: boolean): string => {
  if (!useTest) return environment.database.connection;

  const test = environment.database.testConnection;
  if (test === undefined) {
    process.stderr.write('DB_TEST_CONNECTION não está definida\n');
    process.exit(1);
  }

  return test;
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const useTest = argv.includes('--test');
  const positional = argv.filter((argument) => !argument.startsWith('--'));
  const command = positional[0] ?? 'status';
  const connection = resolveConnection(useTest);

  switch (command) {
    case 'up': {
      const { applied } = await runMigrations(connection, { log: write });
      write(applied.length === 0 ? 'nada pendente' : `${applied.length} aplicada(s)`);
      return;
    }

    case 'down': {
      const steps = Number(positional[1] ?? 1);
      if (!Number.isInteger(steps) || steps < 1) {
        process.stderr.write('down espera um número inteiro de passos\n');
        process.exit(1);
      }

      const { applied } = await rollbackMigrations(connection, steps, { log: write });
      write(applied.length === 0 ? 'nada a desfazer' : `${applied.length} desfeita(s)`);
      return;
    }

    case 'status': {
      const status = await migrationStatus(connection);

      write(`aplicadas (${status.applied.length}):`);
      for (const row of status.applied) {
        write(`  ✓ ${row.name}  ${row.applied_at.toISOString()}  ${row.duration_ms} ms`);
      }

      write(`pendentes (${status.pending.length}):`);
      for (const name of status.pending) write(`  · ${name}`);
      return;
    }

    default:
      process.stderr.write(`comando desconhecido: ${command}\n`);
      process.stderr.write('uso: migrate [up | down [n] | status] [--test]\n');
      process.exit(1);
  }
};

try {
  await main();
} catch (error) {
  if (error instanceof MigrationError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }

  throw error;
}
