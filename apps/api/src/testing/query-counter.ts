/**
 * T-11 · O contador de consultas.
 *
 * O driver avisa de cada statement que envia (`debug`, ligado por `onQuery` em
 * `createConnection`). Nem todo aviso é uma consulta da tela:
 *
 * - **controle**: `begin`/`commit`/`rollback`/`savepoint` que o `UnitOfWork`
 *   abre em volta da leitura. Não é consulta, mas é ida ao banco, então o
 *   relatório mostra o número à parte em vez de escondê-lo;
 * - **driver**: o `select … from pg_catalog.pg_type` que o `postgres` faz uma
 *   vez por conexão nova, para aprender os tipos de array. Quem o dispara é o
 *   tamanho do pool, não a rota.
 *
 * O orçamento vale para `queries`: o que o código da rota decidiu perguntar.
 */
export type StatementKind = 'query' | 'control' | 'driver';

const CONTROL = /^\s*(begin|commit|rollback|savepoint|release\s+savepoint)\b/i;
const DRIVER_BOOTSTRAP = /from\s+pg_catalog\.pg_type\s+a\b[\s\S]*typcategory\s*=\s*'A'/i;
const DRIVER_STATE = /^\s*show\s+transaction_read_only\b/i;

export const classifyStatement = (statement: string): StatementKind => {
  if (CONTROL.test(statement)) return 'control';
  if (DRIVER_BOOTSTRAP.test(statement) || DRIVER_STATE.test(statement)) return 'driver';
  return 'query';
};

export type QueryCount = {
  readonly queries: number;
  readonly control: number;
  readonly driver: number;
  /** O texto das consultas, na ordem, para a falha dizer *qual* foi a terceira. */
  readonly statements: readonly string[];
};

export type QueryCounter = {
  /** Passado a `createConnection({ onQuery })`. */
  readonly record: (statement: string) => void;
  /** Conta só o que acontece enquanto `work` roda. */
  readonly measure: <T>(
    work: () => Promise<T>,
  ) => Promise<{ result: T; count: QueryCount }>;
};

export const createQueryCounter = (): QueryCounter => {
  let window: { queries: string[]; control: number; driver: number } | null = null;

  return {
    record: (statement) => {
      if (window === null) return;

      const kind = classifyStatement(statement);
      if (kind === 'control') window.control += 1;
      else if (kind === 'driver') window.driver += 1;
      else window.queries.push(statement.replace(/\s+/g, ' ').trim());
    },

    measure: async (work) => {
      if (window !== null) throw new Error('medições de consulta não se aninham');

      const current = { queries: [] as string[], control: 0, driver: 0 };
      window = current;

      try {
        const result = await work();
        return {
          result,
          count: {
            queries: current.queries.length,
            control: current.control,
            driver: current.driver,
            statements: current.queries,
          },
        };
      } finally {
        window = null;
      }
    },
  };
};
