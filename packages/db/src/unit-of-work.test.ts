import { DatabaseError, NotFoundError } from '@patrimonio/application';
import { dedupeKey } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';
import { unwrapFailure, unwrapSuccess } from '@patrimonio/shared/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { closeDatabase } from './postgresql.js';
import type { Sql } from './postgresql.js';
import { createTestConnection, prepareTestDatabase } from './testing/database.js';
import { createUnitOfWork } from './unit-of-work.js';
import type { DbRepositories } from './unit-of-work.js';

let sql: Sql;
let uow: ReturnType<typeof createUnitOfWork>;

const INSTITUTION = '0191e5a0-0000-7000-8000-0000000000aa';

beforeAll(async () => {
  sql = createTestConnection();
  await prepareTestDatabase(sql);
  uow = createUnitOfWork(sql);
});

afterAll(async () => {
  await closeDatabase(sql);
});

afterEach(async () => {
  // Estes testes comitam de propósito: a limpeza é explícita.
  await sql`delete from pipeline_outbox`;
  await sql`delete from institution where id = ${INSTITUTION}`;
});

describe('transação', () => {
  it('um failure dentro do trabalho desfaz tudo o que foi escrito', async () => {
    const result = await uow.run(async (repositories) => {
      const { tx } = repositories as DbRepositories;

      await tx`
        insert into institution (id, name, role)
        values (${INSTITUTION}, 'Corretora Abortada', 'custodian')
      `;
      await repositories.outbox.enqueue([
        {
          stage: 'recalc',
          dedupe_key: dedupeKey.recalc('longo-prazo'),
          payload: { portfolio_id: 'longo-prazo', from_date: '2024-01-10' },
        },
      ]);

      return failure(new NotFoundError('carteira inexistente'));
    });

    expect(unwrapFailure(result)).toBeInstanceOf(NotFoundError);

    // Nem a instituição nem o evento ficaram: os dois morreram juntos.
    const [institutions] = await sql<{ total: string }[]>`
      select count(*)::text as total from institution where id = ${INSTITUTION}
    `;
    const [events] = await sql<{ total: string }[]>`
      select count(*)::text as total from pipeline_outbox
    `;

    expect(Number(institutions?.total)).toBe(0);
    expect(Number(events?.total)).toBe(0);
  });

  it('o sucesso comita, e o que foi escrito fica', async () => {
    const result = await uow.run(async (repositories) =>
      repositories.outbox.enqueue([
        {
          stage: 'close',
          dedupe_key: dedupeKey.close('2024-01-10'),
          payload: { reference_date: '2024-01-10' },
        },
      ]),
    );

    expect(unwrapSuccess(result)).toHaveLength(1);

    const [row] = await sql<{ total: string }[]>`
      select count(*)::text as total from pipeline_outbox
    `;
    expect(Number(row?.total)).toBe(1);
  });

  it('erro inesperado do banco volta como AppError, não como exceção', async () => {
    const result = await uow.run(async (repositories) => {
      const { tx } = repositories as DbRepositories;
      await tx.unsafe('select * from tabela_que_nao_existe');
      return success('não chega aqui');
    });

    expect(unwrapFailure(result)).toBeInstanceOf(DatabaseError);
  });
});

describe('trava de escopo', () => {
  it('dois trabalhos na mesma carteira serializam, com atraso entre leitura e escrita', async () => {
    await sql`
      insert into institution (id, name, role, brokerage_per_order)
      values (${INSTITUTION}, 'Corretora Concorrente', 'custodian', 0)
    `;

    // Lê, espera e escreve o valor lido + 1. Sem a trava os dois leem 0 e o
    // resultado final é 1 — a corrida que aparece como número errado meses
    // depois, sem rastro.
    const increment = async () =>
      uow.run(
        async (repositories) => {
          const { tx } = repositories as DbRepositories;

          const [row] = await tx<{ value: string }[]>`
            select brokerage_per_order::text as value
              from institution where id = ${INSTITUTION}
          `;

          await new Promise((resolve) => setTimeout(resolve, 80));

          await tx`
            update institution
               set brokerage_per_order = ${Number(row?.value ?? 0) + 1}
             where id = ${INSTITUTION}
          `;

          return success(undefined);
        },
        { lock: 'portfolio:longo-prazo' },
      );

    await Promise.all([increment(), increment()]);

    const [row] = await sql<{ value: string }[]>`
      select brokerage_per_order::text as value from institution where id = ${INSTITUTION}
    `;

    expect(Number(row?.value)).toBe(2);
  });
});
