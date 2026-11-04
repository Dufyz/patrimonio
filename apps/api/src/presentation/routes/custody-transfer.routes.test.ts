import { positionsResourceSchema } from '@patrimonio/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createApiHarness,
  resetSourceTables,
  seedInstitution,
} from '../../testing/harness.js';
import type { ApiHarness } from '../../testing/harness.js';

/**
 * A troca de custodiante. O que esta suíte prova é a regra, e não o SQL: a
 * transferência não mexe em posição nem em resultado, a origem é a custódia
 * atual, e a ordem dos eventos não pode andar para trás.
 */

let harness: ApiHarness;
let carteira: string;
let corretoraA: string;
let corretoraB: string;
let corretoraC: string;
let itub4: string;

const hoje = (): string => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  harness = await createApiHarness();
});

afterAll(async () => {
  await harness.close();
});

beforeEach(async () => {
  await resetSourceTables(harness.sql);

  const criada = await request(harness.app)
    .post('/api/portfolios')
    .send({ name: 'Longo prazo' });
  carteira = criada.body.portfolio.id;
  corretoraA = await seedInstitution(harness.sql, 'Corretora A');
  corretoraB = await seedInstitution(harness.sql, 'Corretora B');
  corretoraC = await seedInstitution(harness.sql, 'Corretora C');

  const compra = await request(harness.app)
    .post('/api/transactions')
    .send({
      kind: 'buy',
      portfolio_id: carteira,
      institution_id: corretoraA,
      asset: { ticker: 'ITUB4', name: 'Itaú Unibanco PN', b3_type: 'stock' },
      trade_date: '2026-02-02',
      quantity: '500',
      unit_price: '29.10',
      fees: '0',
    });
  itub4 = compra.body.transaction.asset_id;
});

const base = (): string =>
  `/api/portfolios/${carteira}/assets/${itub4}/custody-transfers`;

const transferir = (body: Record<string, unknown>) =>
  request(harness.app)
    .post(base())
    .send({ transfer_date: '2026-03-10', ...body });

describe('POST /custody-transfers', () => {
  it('grava a troca de A para B, e a origem vem do livro', async () => {
    const response = await transferir({ to_institution_id: corretoraB });

    expect(response.status).toBe(201);
    expect(response.body.from_institution_name).toBe('Corretora A');
    expect(response.body.to_institution_name).toBe('Corretora B');
    expect(response.body.custody_transfer.from_institution_id).toBe(corretoraA);
  });

  it('Posições passa a mostrar a nova custódia, sem mexer na posição', async () => {
    await harness.sql`
      INSERT INTO position_daily
        (portfolio_id, asset_id, position_date, quantity, avg_price, cost_basis,
         market_value, price_source_kind)
      VALUES
        (${carteira}, ${itub4}, ${hoje()}, '500', '29.10', '14550.00', '18420.00', 'fresh')
    `;

    await transferir({ to_institution_id: corretoraB });

    const body = positionsResourceSchema.parse(
      (await request(harness.app).get(`/api/positions?portfolio_id=${carteira}`)).body,
    );
    const linha = body.groups[0]?.positions[0];

    expect(linha?.institution_id).toBe(corretoraB);
    expect(linha?.quantity).toBe('500.00000000');
    expect(body.total.value).toBe('18420.00');
  });

  it('não enfileira recálculo: a troca não muda número nenhum', async () => {
    await harness.sql`DELETE FROM pipeline_outbox`;

    await transferir({ to_institution_id: corretoraB });

    const [row] = await harness.sql<{ total: number }[]>`
      SELECT COUNT(*)::INT AS total FROM pipeline_outbox
    `;
    expect(row?.total).toBe(0);
  });

  it('a segunda troca parte de onde o papel está agora', async () => {
    await transferir({ to_institution_id: corretoraB });
    const segunda = await transferir({
      to_institution_id: corretoraC,
      transfer_date: '2026-04-01',
    });

    expect(segunda.status).toBe(201);
    expect(segunda.body.custody_transfer.from_institution_id).toBe(corretoraB);
  });

  it('transferir para onde o papel já está é recusado', async () => {
    const response = await transferir({ to_institution_id: corretoraA });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/já está custodiado/);
  });

  it('data anterior ao último lançamento é recusada', async () => {
    const response = await transferir({
      to_institution_id: corretoraB,
      transfer_date: '2026-01-15',
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/não pode ser anterior/);
  });

  it('data no futuro é recusada', async () => {
    const response = await transferir({
      to_institution_id: corretoraB,
      transfer_date: '2999-01-01',
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/futuro/);
  });

  it('sem posição aberta não há o que transferir', async () => {
    await request(harness.app).post('/api/transactions').send({
      kind: 'sell',
      portfolio_id: carteira,
      institution_id: corretoraA,
      asset_id: itub4,
      trade_date: '2026-02-20',
      quantity: '500',
      unit_price: '31.00',
      fees: '0',
    });

    const response = await transferir({ to_institution_id: corretoraB });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/posição aberta/);
  });

  it('instituição inexistente devolve 404', async () => {
    const response = await transferir({
      to_institution_id: '0b4cf1d2-9b3a-4f4e-9f1a-000000000000',
    });

    expect(response.status).toBe(404);
  });
});

describe('histórico e desfazer', () => {
  it('lista da mais recente para a mais antiga', async () => {
    await transferir({ to_institution_id: corretoraB });
    await transferir({ to_institution_id: corretoraC, transfer_date: '2026-04-01' });

    const lista = await request(harness.app).get(base());

    expect(lista.status).toBe(200);
    expect(lista.body.custody_transfers).toHaveLength(2);
    expect(lista.body.custody_transfers[0].to_institution_id).toBe(corretoraC);
  });

  it('desfazer a mais recente devolve a custódia anterior', async () => {
    await transferir({ to_institution_id: corretoraB });
    const segunda = await transferir({
      to_institution_id: corretoraC,
      transfer_date: '2026-04-01',
    });

    const desfeita = await request(harness.app).delete(
      `${base()}/${segunda.body.custody_transfer.id}`,
    );
    expect(desfeita.status).toBe(200);

    // A próxima troca parte de B de novo.
    const outra = await transferir({
      to_institution_id: corretoraC,
      transfer_date: '2026-04-02',
    });
    expect(outra.body.custody_transfer.from_institution_id).toBe(corretoraB);
  });

  it('só a mais recente pode ser desfeita', async () => {
    const primeira = await transferir({ to_institution_id: corretoraB });
    await transferir({ to_institution_id: corretoraC, transfer_date: '2026-04-01' });

    const response = await request(harness.app).delete(
      `${base()}/${primeira.body.custody_transfer.id}`,
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/mais recente/);
  });
});
