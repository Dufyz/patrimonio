import { closeDatabase, createConnection } from '../postgresql.js';
import { fetchInstitutionNames } from '../seeds/fetch_institutions.js';
import { loadBusinessDays } from '../seeds/load_business_days.js';
import { loadInstitutions } from '../seeds/load_institutions.js';
import { runMigrations } from './runner.js';
import type { RunResult } from './runner.js';

/** Abaixo disso o catálogo é considerado vazio (o seed de demonstração cria só algumas). */
const MIN_INSTITUTIONS = 50;

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

    // As instituições são dado de referência como o calendário, mas vêm de fora:
    // carrega só enquanto o catálogo está vazio, e uma fonte fora do ar não
    // derruba o boot — a próxima subida tenta de novo.
    const [counted] = await sql<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM institution WHERE country = 'BR'
    `;

    if (Number(counted?.total ?? 0) < MIN_INSTITUTIONS) {
      try {
        const { names } = await fetchInstitutionNames();
        const loaded = await loadInstitutions(sql, names);
        options?.log?.(`instituições carregadas: ${loaded.inserted} novas`);
      } catch (error) {
        options?.log?.(
          `instituições não carregadas (${error instanceof Error ? error.message : String(error)}); tenta de novo na próxima subida`,
        );
      }
    }
  } finally {
    await closeDatabase(sql);
  }

  return result;
};
