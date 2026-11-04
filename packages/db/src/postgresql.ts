import postgres from 'postgres';

/** O driver devolve `date` como string, não como `Date`: ver DATE_AS_STRING. */
export type CustomTypes = { date: string };

export type Sql = postgres.Sql<CustomTypes>;
export type TransactionSql = postgres.TransactionSql<CustomTypes>;
/** Toda consulta aceita a conexão global ou a da transação, sem distinção. */
export type Connection = Sql | TransactionSql;

export type ConnectionOptions = {
  readonly connection: string;
  readonly poolSize: number;
  readonly applicationName: string;
  readonly onQuery?: (query: string) => void;
};

/**
 * `NUMERIC` entra e sai do driver como string, e isso é o comportamento certo:
 * `NUMERIC(20,8)` não cabe em `double`. O cálculo acontece em `decimal.js`
 * dentro de `calc`, e em nenhum ponto do caminho um valor monetário vira
 * `number` de JavaScript.
 *
 * `date` também fica como string: o driver devolveria `Date`, e um `Date` de
 * "2024-03-10" interpretado em outro fuso vira 09/03 — o deslocamento de um dia
 * que reaparece no fechamento e na contagem de dia útil.
 */
const DATE_AS_STRING = {
  // `to` é o OID usado ao serializar; `from` são os OIDs que esta função lê.
  date: {
    to: 1082,
    from: [1082],
    serialize: (value: string): string => value,
    parse: (value: string): string => value,
  },
};

export const createConnection = (options: ConnectionOptions): Sql =>
  postgres(options.connection, {
    max: options.poolSize,
    // O pooler da Supabase roda em modo transação: statement preparado entre
    // conexões não sobrevive a ele.
    prepare: false,
    types: DATE_AS_STRING,
    connection: { application_name: options.applicationName, TimeZone: 'UTC' },
    onnotice: () => {},
    ...(options.onQuery
      ? { debug: (_connection, query) => options.onQuery?.(query) }
      : {}),
  });

/** Usado pelo healthcheck profundo: verifica o Postgres separadamente do Redis. */
export const pingDatabase = async (sql: Connection): Promise<boolean> => {
  try {
    const rows = await sql<{ ok: number }[]>`SELECT 1 AS ok`;
    return rows[0]?.ok === 1;
  } catch {
    return false;
  }
};

export const closeDatabase = async (sql: Sql, timeoutSeconds = 5): Promise<void> => {
  await sql.end({ timeout: timeoutSeconds });
};
