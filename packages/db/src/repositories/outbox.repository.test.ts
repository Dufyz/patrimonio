import { dedupeKey } from '@patrimonio/domain';
import { unwrapSuccess } from '@patrimonio/shared/testing';
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
import { createOutboxRepository } from './outbox.repository.js';

let sql: Sql;
let tx: TestTransaction;
let outbox: ReturnType<typeof createOutboxRepository>;

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

beforeEach(async () => {
  tx = await beginTestTransaction(sql);
  outbox = createOutboxRepository(tx);
});

afterEach(async () => {
  await rollbackTestTransaction(tx);
});

const seconds = (count: number): Date => new Date(Date.now() + count * 1_000);

describe('enqueue', () => {
  it('grava o pedido e diz que não havia outro igual pendente', async () => {
    const [event] = unwrapSuccess(
      await outbox.enqueue([
        {
          stage: 'recalc',
          dedupe_key: dedupeKey.recalc('longo-prazo'),
          payload: { portfolio_id: 'longo-prazo', from_date: '2024-01-10' },
        },
      ]),
    );

    expect(event?.already_queued).toBe(false);
    expect(event?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('dois pedidos na mesma rajada viram um recálculo, não dois', async () => {
    const key = dedupeKey.recalc('longo-prazo');

    const first = unwrapSuccess(
      await outbox.enqueue([
        {
          stage: 'recalc',
          dedupe_key: key,
          payload: { portfolio_id: 'longo-prazo', from_date: '2024-01-10' },
        },
      ]),
    );

    const second = unwrapSuccess(
      await outbox.enqueue([
        {
          stage: 'recalc',
          dedupe_key: key,
          payload: { portfolio_id: 'longo-prazo', from_date: '2024-02-20' },
        },
      ]),
    );

    expect(first[0]?.already_queued).toBe(false);
    expect(second[0]?.already_queued).toBe(true);
    expect(second[0]?.id).toBe(first[0]?.id);

    const [pending] = await tx<{ total: string }[]>`
      SELECT COUNT(*)::TEXT AS total FROM pipeline_outbox WHERE dedupe_key = ${key}
    `;
    expect(Number(pending?.total)).toBe(1);
  });

  it('o from_date do evento pendente recua para a data mais antiga pedida', async () => {
    const key = dedupeKey.recalc('longo-prazo');

    await outbox.enqueue([
      {
        stage: 'recalc',
        dedupe_key: key,
        payload: { portfolio_id: 'longo-prazo', from_date: '2024-02-20' },
      },
    ]);

    // Editar um lançamento de 2021 depois pede o histórico inteiro de novo.
    await outbox.enqueue([
      {
        stage: 'recalc',
        dedupe_key: key,
        payload: { portfolio_id: 'longo-prazo', from_date: '2021-03-12' },
      },
    ]);

    const [row] = await tx<{ from_date: string }[]>`
      SELECT payload ->> 'from_date' AS from_date
        FROM pipeline_outbox WHERE dedupe_key = ${key}
    `;

    expect(row?.from_date).toBe('2021-03-12');
  });

  it('a espera renovada não passa do teto contado no primeiro pedido', async () => {
    const key = dedupeKey.recalc('curto-prazo');
    const ceiling = seconds(10);

    await outbox.enqueue([
      {
        stage: 'recalc',
        dedupe_key: key,
        payload: { portfolio_id: 'curto-prazo', from_date: '2024-01-10' },
        available_at: seconds(2),
        debounce_until: ceiling,
      },
    ]);

    // A rajada continua e empurra a espera — mas o teto é do primeiro pedido.
    await outbox.enqueue([
      {
        stage: 'recalc',
        dedupe_key: key,
        payload: { portfolio_id: 'curto-prazo', from_date: '2024-01-10' },
        available_at: seconds(600),
        debounce_until: seconds(600),
      },
    ]);

    const [row] = await tx<{ available_at: Date; debounce_until: Date }[]>`
      SELECT available_at, debounce_until
        FROM pipeline_outbox WHERE dedupe_key = ${key}
    `;

    expect(row?.available_at.getTime()).toBe(ceiling.getTime());
    expect(row?.debounce_until.getTime()).toBe(ceiling.getTime());
  });

  it('um evento já despachado não bloqueia o próximo pedido da mesma chave', async () => {
    const key = dedupeKey.recalc('longo-prazo');

    const first = unwrapSuccess(
      await outbox.enqueue([
        {
          stage: 'recalc',
          dedupe_key: key,
          payload: { portfolio_id: 'longo-prazo', from_date: '2024-01-10' },
        },
      ]),
    );
    await outbox.markDispatched([first[0]!.id]);

    const second = unwrapSuccess(
      await outbox.enqueue([
        {
          stage: 'recalc',
          dedupe_key: key,
          payload: { portfolio_id: 'longo-prazo', from_date: '2024-03-01' },
        },
      ]),
    );

    expect(second[0]?.already_queued).toBe(false);
    expect(second[0]?.id).not.toBe(first[0]?.id);
  });

  it('lista vazia não vira consulta', async () => {
    expect(unwrapSuccess(await outbox.enqueue([]))).toEqual([]);
  });
});

describe('claimPending', () => {
  it('só entrega quem já está disponível', async () => {
    await outbox.enqueue([
      {
        stage: 'close',
        dedupe_key: dedupeKey.close('2024-01-10'),
        payload: { reference_date: '2024-01-10' },
      },
      {
        stage: 'alerts',
        dedupe_key: dedupeKey.alerts('2024-01-10'),
        payload: { reference_date: '2024-01-10' },
        available_at: seconds(3_600),
      },
    ]);

    const claimed = unwrapSuccess(await outbox.claimPending(10));

    expect(claimed.map((event) => event.stage)).toEqual(['close']);
  });

  it('não entrega evento já despachado nem evento que falhou de vez', async () => {
    const enqueued = unwrapSuccess(
      await outbox.enqueue([
        {
          stage: 'close',
          dedupe_key: dedupeKey.close('2024-01-11'),
          payload: { reference_date: '2024-01-11' },
        },
        {
          stage: 'market',
          dedupe_key: dedupeKey.market('2024-01-11'),
          payload: { reference_date: '2024-01-11' },
        },
      ]),
    );

    await outbox.markDispatched([enqueued[0]!.id]);
    await outbox.markFailed(enqueued[1]!.id, 'ticker inexistente', false);

    expect(unwrapSuccess(await outbox.claimPending(10))).toEqual([]);
  });

  it('o payload volta tipado pelo parser, com o carimbo normalizado', async () => {
    await outbox.enqueue([
      {
        stage: 'recalc',
        dedupe_key: dedupeKey.recalc('longo-prazo'),
        payload: { portfolio_id: 'longo-prazo', from_date: '2021-03-12' },
      },
    ]);

    const [event] = unwrapSuccess(await outbox.claimPending(1));

    expect(event?.payload).toEqual({
      portfolio_id: 'longo-prazo',
      from_date: '2021-03-12',
    });
    expect(event?.available_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event?.dispatched_at).toBeNull();
  });
});

describe('marcações de execução', () => {
  it('markDispatched marca uma vez e não remarca', async () => {
    const [event] = unwrapSuccess(
      await outbox.enqueue([
        {
          stage: 'backup',
          dedupe_key: dedupeKey.backup('2024-01-10'),
          payload: { reference_date: '2024-01-10' },
        },
      ]),
    );

    expect(unwrapSuccess(await outbox.markDispatched([event!.id]))).toBe(1);
    expect(unwrapSuccess(await outbox.markDispatched([event!.id]))).toBe(0);
  });

  it('falha transitória não marca failed_at; definitiva marca', async () => {
    const enqueued = unwrapSuccess(
      await outbox.enqueue([
        {
          stage: 'market',
          dedupe_key: dedupeKey.market('2024-02-01'),
          payload: { reference_date: '2024-02-01' },
        },
        {
          stage: 'close',
          dedupe_key: dedupeKey.close('2024-02-01'),
          payload: { reference_date: '2024-02-01' },
        },
      ]),
    );

    await outbox.markFailed(enqueued[0]!.id, 'provedor fora do ar', true);
    await outbox.markFailed(enqueued[1]!.id, 'carteira inexistente', false);

    const transient = unwrapSuccess(await outbox.findById(enqueued[0]!.id));
    const definitive = unwrapSuccess(await outbox.findById(enqueued[1]!.id));

    expect(transient?.failed_at).toBeNull();
    expect(transient?.error).toBe('provedor fora do ar');
    expect(definitive?.failed_at).not.toBeNull();
  });

  it('markStarted conta a tentativa e markCompleted limpa o erro', async () => {
    const [event] = unwrapSuccess(
      await outbox.enqueue([
        {
          stage: 'close',
          dedupe_key: dedupeKey.close('2024-02-02'),
          payload: { reference_date: '2024-02-02' },
        },
      ]),
    );

    await outbox.markStarted(event!.id);
    await outbox.markFailed(event!.id, 'estourou o tempo', true);
    await outbox.markStarted(event!.id);
    await outbox.markCompleted(event!.id);

    const stored = unwrapSuccess(await outbox.findById(event!.id));

    expect(stored?.attempts).toBe(2);
    expect(stored?.error).toBeNull();
    expect(stored?.completed_at).not.toBeNull();
  });

  it('findById de um id inexistente devolve null, não falha', async () => {
    const missing = unwrapSuccess(
      await outbox.findById('0191e5a0-0000-7000-8000-00000000dead'),
    );

    expect(missing).toBeNull();
  });
});

describe('lastCompletedExecution', () => {
  it('devolve a data do último fechamento concluído, que o healthcheck reporta', async () => {
    const enqueued = unwrapSuccess(
      await outbox.enqueue([
        {
          stage: 'close',
          dedupe_key: dedupeKey.close('2024-03-01'),
          payload: { reference_date: '2024-03-01' },
        },
      ]),
    );
    await outbox.markCompleted(enqueued[0]!.id);

    const execution = unwrapSuccess(await outbox.lastCompletedExecution('close'));

    expect(execution?.reference_date).toBe('2024-03-01');
    expect(execution?.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sem nenhum fechamento concluído devolve null', async () => {
    expect(unwrapSuccess(await outbox.lastCompletedExecution('close'))).toBeNull();
  });
});
