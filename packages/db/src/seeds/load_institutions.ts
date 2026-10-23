import { v7 as uuidv7 } from 'uuid';

import { ARRAY_OID } from '../support/array_oid.js';
import type { Connection } from '../postgresql.js';

/**
 * Insere as instituições brasileiras do catálogo numa escrita só. Quem já existe
 * (mesmo nome, sem diferenciar caixa) fica como está: a carga é repetível e não
 * mexe no que a pessoa já usou.
 */
export const loadInstitutions = async (
  sql: Connection,
  names: readonly string[],
): Promise<{ readonly inserted: number; readonly received: number }> => {
  if (names.length === 0) return { inserted: 0, received: 0 };

  const rows = await sql<{ id: string }[]>`
    INSERT INTO institution (id, name, country)
    SELECT *
      FROM UNNEST(
        ${sql.array(
          names.map(() => uuidv7()),
          ARRAY_OID.uuid,
        )}::UUID[],
        ${sql.array([...names], ARRAY_OID.text)}::TEXT[],
        ${sql.array(
          names.map(() => 'BR'),
          ARRAY_OID.text,
        )}::TEXT[]
      )
    ON CONFLICT DO NOTHING
    RETURNING id
  `;

  return { inserted: rows.length, received: names.length };
};
