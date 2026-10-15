import { closeDatabase, createConnection } from '../postgresql.js';
import { loadBusinessDays } from '../seeds/load_business_days.js';
import { runMigrations } from './runner.js';
import type { RunResult } from './runner.js';

/**
 * Sobe o schema e carrega o calendário de dias úteis. O calendário é dado de
 * referência, não de uso, e o preço tem chave estrangeira para ele: um banco
 * migrado e sem calendário recusa todo preço. A carga é um upsert, então
 * repeti-la a cada subida é barato e dispensa lembrar de um segundo comando.
 */
export const migrateDatabase = async (
  connection: string,
  options?: { readonly log?: (line: string) => void },
): Promise<RunResult> => {
  const result = await runMigrations(connection, options);

  const sql = createConnection({
    connection,
    poolSize: 1,
    applicationName: 'patrimonio-migrate',
  });

  try {
    const { rows, years } = await loadBusinessDays(sql);
    options?.log?.(`calendário carregado: ${rows} dias, ${years}`);
  } finally {
    await closeDatabase(sql);
  }

  return result;
};
