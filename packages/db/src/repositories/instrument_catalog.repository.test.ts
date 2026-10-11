import { unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '../postgresql.js';
import type { Sql } from '../postgresql.js';
import {
  beginTestTransaction,
  createTestConnection,
  prepareTestDatabase,
  repositoriesOn,
  rollbackTestTransaction,
} from '../testing/database.js';
import type { TestTransaction } from '../testing/database.js';

let sql: Sql;
let tx: TestTransaction;
let repositories: ReturnType<typeof repositoriesOn>;

const row = (ticker: string, name: string, b3_type: 'stock' | 'fii' | 'etf' | 'bdr') => ({
  ticker,
  name,
  b3_type,
  maturity_date: null,
  source: 'cotahist',
  active: true,
  last_trade_date: '2026-10-09',
});

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

beforeEach(async () => {
  tx = await beginTestTransaction(sql);
  repositories = repositoriesOn(tx);
  await tx`DELETE FROM listed_instrument`;
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

describe('catálogo de instrumentos', () => {
  const load = async () =>
    repositories.instruments.upsertMany([
      row('BOVA11', 'ISHARES IBOVESPA', 'etf'),
      row('ITUB4', 'ITAUUNIBANCO PN', 'stock'),
      row('ITSA4', 'ITAUSA PN', 'stock'),
      row('KNRI11', 'KINEA RENDIMENTOS', 'fii'),
    ]);

  it('carrega em lote e recarregar não duplica', async () => {
    expect(unwrapSuccess(await load())).toEqual({ created: 4, updated: 0 });
    expect(unwrapSuccess(await load())).toEqual({ created: 0, updated: 4 });

    const summary = unwrapSuccess(await repositories.instruments.summary());
    expect(summary.total).toBe(4);
    expect(summary.by_type).toMatchObject({ stock: 2, fii: 1, etf: 1, bdr: 0 });
  });

  it('guarda o ticker em maiúsculas e o encontra sem distinguir caixa', async () => {
    unwrapSuccess(await repositories.instruments.upsertMany([row('bova11', 'X', 'etf')]));

    const found = unwrapSuccess(await repositories.instruments.findByTicker('Bova11'));
    expect(found?.ticker).toBe('BOVA11');
  });

  it('busca por ticker exato primeiro, depois prefixo do ticker, depois nome', async () => {
    unwrapSuccess(await load());

    const byTicker = unwrapSuccess(
      await repositories.instruments.search({ text: 'itub4', limit: 10 }),
    );
    expect(byTicker.items.map((item) => item.ticker)).toEqual(['ITUB4']);

    const byPrefix = unwrapSuccess(
      await repositories.instruments.search({ text: 'it', limit: 10 }),
    );
    expect(byPrefix.items.map((item) => item.ticker)).toEqual(['ITSA4', 'ITUB4']);
    expect(byPrefix.total).toBe(2);
  });

  it('compara sem acento e acha pelo nome', async () => {
    unwrapSuccess(
      await repositories.instruments.upsertMany([
        row('ITUB4', 'ITAÚ UNIBANCO PN', 'stock'),
      ]),
    );

    const found = unwrapSuccess(
      await repositories.instruments.search({ text: 'itau', limit: 10 }),
    );
    expect(found.items.map((item) => item.ticker)).toEqual(['ITUB4']);
  });

  it('filtra por tipo e respeita o limite, contando o total', async () => {
    unwrapSuccess(await load());

    const stocks = unwrapSuccess(
      await repositories.instruments.search({ types: ['stock'], limit: 1 }),
    );
    expect(stocks.items).toHaveLength(1);
    expect(stocks.total).toBe(2);
  });

  it('não depende de carteira: lista sem texto, por ticker', async () => {
    unwrapSuccess(await load());

    const all = unwrapSuccess(await repositories.instruments.search({ limit: 10 }));
    expect(all.items.map((item) => item.ticker)).toEqual([
      'BOVA11',
      'ITSA4',
      'ITUB4',
      'KNRI11',
    ]);
  });

  it('desativa o que a fonte não trouxe e esconde da busca por padrão', async () => {
    unwrapSuccess(await load());

    const changed = unwrapSuccess(
      await repositories.instruments.deactivateMissing('cotahist', ['BOVA11', 'ITUB4']),
    );
    expect(changed).toBe(2);

    const visible = unwrapSuccess(await repositories.instruments.search({ limit: 10 }));
    expect(visible.items.map((item) => item.ticker)).toEqual(['BOVA11', 'ITUB4']);

    const everything = unwrapSuccess(
      await repositories.instruments.search({ includeInactive: true, limit: 10 }),
    );
    expect(everything.total).toBe(4);
  });

  it('recarregar um papel inativo o reativa', async () => {
    unwrapSuccess(await load());
    unwrapSuccess(await repositories.instruments.deactivateMissing('cotahist', []));
    unwrapSuccess(
      await repositories.instruments.upsertMany([
        row('ITUB4', 'ITAUUNIBANCO PN', 'stock'),
      ]),
    );

    const found = unwrapSuccess(await repositories.instruments.findByTicker('ITUB4'));
    expect(found?.active).toBe(true);
  });
});
