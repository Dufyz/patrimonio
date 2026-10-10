import { unwrapFailure, unwrapSuccess } from '@patrimonio/shared/testing';
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
import { createPortfolioRepository } from './portfolio.repository.js';

let sql: Sql;
let tx: TestTransaction;
let portfolios: ReturnType<typeof createPortfolioRepository>;

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

beforeEach(async () => {
  tx = await beginTestTransaction(sql);
  portfolios = createPortfolioRepository(tx);
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

const categoria = async (name: string): Promise<string> => {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO category (id, name, color_token)
    VALUES (GEN_RANDOM_UUID(), ${name}, 'class.stock')
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('categoria não criada');
  return id;
};

describe('carteira', () => {
  it('nasce com os padrões do schema e sem recálculo pendente', async () => {
    const portfolio = unwrapSuccess(await portfolios.create({ name: 'Longo prazo' }));

    expect(portfolio.recalc_status).toBe('idle');
    expect(portfolio.rebalance_mode).toBe('contributions_only');
    expect(portfolio.archived_at).toBeNull();
  });

  it('percentual volta como string, com as casas que o banco guarda', async () => {
    const portfolio = unwrapSuccess(
      await portfolios.create({ name: 'Longo prazo', tolerance_pp: '3.5' }),
    );

    // NUMERIC não vira number em nenhum ponto do caminho.
    expect(portfolio.tolerance_pp).toBe('3.50');
    expect(typeof portfolio.tolerance_pp).toBe('string');
  });

  it('nome repetido entre ativas vira conflito, não erro de banco', async () => {
    await portfolios.create({ name: 'Longo prazo' });
    const segunda = await portfolios.create({ name: 'longo prazo' });

    expect(unwrapFailure(segunda).statusCode).toBe(409);
  });

  it('arquivar libera o nome e mantém a carteira', async () => {
    const primeira = unwrapSuccess(await portfolios.create({ name: 'Reserva' }));
    unwrapSuccess(await portfolios.setArchived(primeira.id, true));

    const segunda = await portfolios.create({ name: 'Reserva' });

    expect(unwrapSuccess(segunda).id).not.toBe(primeira.id);
  });

  it('editar sem campo nenhum devolve a carteira como está', async () => {
    const criada = unwrapSuccess(await portfolios.create({ name: 'Longo prazo' }));

    const igual = unwrapSuccess(await portfolios.update(criada.id, {}));

    expect(igual?.name).toBe('Longo prazo');
  });

  it('tolerância acima de 100 é recusada pelo banco como erro de cliente', async () => {
    const recusada = await portfolios.create({
      name: 'Longo prazo',
      tolerance_pp: '140',
    });

    expect(unwrapFailure(recusada).statusCode).toBe(400);
  });
});

describe('alvo de alocação', () => {
  it('alvo somando 100% é aceito', async () => {
    const portfolio = unwrapSuccess(await portfolios.create({ name: 'Longo prazo' }));
    const acoes = await categoria('Ações');
    const fiis = await categoria('FIIs');

    const saved = unwrapSuccess(
      await portfolios.replaceTargets(portfolio.id, [
        { category_id: acoes, target_pct: '60' },
        { category_id: fiis, target_pct: '40' },
      ]),
    );

    expect(saved).toHaveLength(2);
    expect(saved[0]?.target_pct).toMatch(/^\d+\.\d{2}$/);
  });

  it('alvo somando 96% é rejeitado pelo banco no commit', async () => {
    const portfolio = unwrapSuccess(await portfolios.create({ name: 'Longo prazo' }));
    const acoes = await categoria('Ações');

    unwrapSuccess(
      await portfolios.replaceTargets(portfolio.id, [
        { category_id: acoes, target_pct: '96' },
      ]),
    );

    // O trigger é diferido: a recusa acontece no commit, não no insert.
    await expect(tx.unsafe('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toThrow(/100/);
  });

  it('trocar o alvo inteiro apaga o anterior na mesma transação', async () => {
    const portfolio = unwrapSuccess(await portfolios.create({ name: 'Longo prazo' }));
    const acoes = await categoria('Ações');
    const fiis = await categoria('FIIs');

    await portfolios.replaceTargets(portfolio.id, [
      { category_id: acoes, target_pct: '60' },
      { category_id: fiis, target_pct: '40' },
    ]);
    const segundo = unwrapSuccess(
      await portfolios.replaceTargets(portfolio.id, [
        { category_id: acoes, target_pct: '100' },
      ]),
    );

    expect(segundo).toHaveLength(1);
    expect(unwrapSuccess(await portfolios.listTargets(portfolio.id))).toHaveLength(1);
  });
});
