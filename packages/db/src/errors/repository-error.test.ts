import {
  BadRequestError,
  ConflictError,
  DatabaseError,
  NotFoundError,
} from '@patrimonio/application';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../postgresql.js';
import type { Sql } from '../postgresql.js';
import {
  beginTestTransaction,
  createTestConnection,
  prepareTestDatabase,
  rollbackTestTransaction,
} from '../testing/database.js';
import type { TestTransaction } from '../testing/database.js';
import { getRepositoryError } from './repository-error.js';

let sql: Sql;
let tx: TestTransaction;

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

beforeEach(async () => {
  tx = await beginTestTransaction(sql);
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

/** Erro de verdade do driver, não um objeto montado à mão. */
const errorOf = async (statement: string): Promise<unknown> => {
  try {
    await tx.unsafe(statement);
    throw new Error(`a instrução não falhou: ${statement}`);
  } catch (error) {
    return error;
  }
};

const INSTITUTION = `
  INSERT INTO institution (id, name, role)
  VALUES ('0191e5a0-0000-7000-8000-0000000000b1', 'Corretora Traduzida', 'custodian')
`;

describe('getRepositoryError', () => {
  it('violação de unicidade vira ConflictError', async () => {
    await tx.unsafe(INSTITUTION);
    const error = getRepositoryError(await errorOf(INSTITUTION));

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.statusCode).toBe(409);
  });

  it('chave estrangeira vira BadRequestError', async () => {
    const error = getRepositoryError(
      await errorOf(`
        INSERT INTO transaction (
          id, kind, trade_date, settlement_date, portfolio_id, institution_id, net_amount
        ) VALUES (
          '0191e5a0-0000-7000-8000-0000000000b2', 'deposit', '2024-01-10', '2024-01-10',
          '0191e5a0-0000-7000-8000-00000000dead', '0191e5a0-0000-7000-8000-00000000beef', 100
        )
      `),
    );

    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.statusCode).toBe(400);
  });

  it('valor fora do enum vira BadRequestError', async () => {
    const error = getRepositoryError(
      await errorOf(`
        INSERT INTO institution (id, name, role)
        VALUES ('0191e5a0-0000-7000-8000-0000000000b3', 'Papel Inválido', 'intermediario')
      `),
    );

    expect(error).toBeInstanceOf(BadRequestError);
  });

  it('regra do banco não satisfeita vira BadRequestError', async () => {
    const error = getRepositoryError(
      await errorOf(`
        INSERT INTO portfolio (id, name, tolerance_pp)
        VALUES ('0191e5a0-0000-7000-8000-0000000000b4', 'Fora da Faixa', 200)
      `),
    );

    expect(error).toBeInstanceOf(BadRequestError);
  });

  it('campo obrigatório ausente vira BadRequestError', async () => {
    const error = getRepositoryError(
      await errorOf(`
        INSERT INTO institution (id, role)
        VALUES ('0191e5a0-0000-7000-8000-0000000000b5', 'custodian')
      `),
    );

    expect(error).toBeInstanceOf(BadRequestError);
  });

  it('qualquer outro erro do driver vira DatabaseError', async () => {
    const error = getRepositoryError(await errorOf('SELECT * FROM tabela_inexistente'));

    expect(error).toBeInstanceOf(DatabaseError);
    expect(error.statusCode).toBe(500);
  });

  it('a mensagem descreve a restrição, nunca os valores da linha', async () => {
    await tx.unsafe(INSTITUTION);
    const error = getRepositoryError(await errorOf(INSTITUTION));

    // O detail do driver traria o valor da linha; a mensagem não.
    expect(error.message).toContain('institution');
    expect(error.message).not.toContain('Corretora Traduzida');
  });

  it('um AppError que veio de dentro do trabalho atravessa intacto', () => {
    const original = new NotFoundError('carteira inexistente');

    expect(getRepositoryError(original)).toBe(original);
  });
});
