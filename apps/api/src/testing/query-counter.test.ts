import { describe, expect, it } from 'vitest';

import { classifyStatement, createQueryCounter } from './query-counter.js';

describe('classificação do que o driver envia', () => {
  it('begin, commit e rollback são controle, não consulta', () => {
    expect(classifyStatement('begin')).toBe('control');
    expect(classifyStatement('begin isolation level read committed')).toBe('control');
    expect(classifyStatement('commit')).toBe('control');
    expect(classifyStatement('ROLLBACK')).toBe('control');
    expect(classifyStatement('savepoint s1')).toBe('control');
  });

  it('a busca de tipos de array que o driver faz por conexão nova não é da rota', () => {
    const bootstrap = `
      select b.oid, b.typarray
      from pg_catalog.pg_type a
      left join pg_catalog.pg_type b on b.oid = a.typelem
      where a.typcategory = 'A'
      group by b.oid, b.typarray
    `;
    expect(classifyStatement(bootstrap)).toBe('driver');
  });

  it('um select de negócio, mesmo sobre pg_type, continua sendo consulta', () => {
    expect(classifyStatement('select * from position_daily')).toBe('query');
    expect(classifyStatement('with x as (select 1) select * from x')).toBe('query');
    expect(classifyStatement('begin_balance_view')).toBe('query');
  });
});

describe('a janela de medição', () => {
  it('conta só o que acontece dentro dela', async () => {
    const counter = createQueryCounter();
    counter.record('select 1 -- antes');

    const { count } = await counter.measure(async () => {
      counter.record('begin');
      counter.record('select  a\n from b');
      counter.record('select c from d');
      counter.record('commit');
    });

    counter.record('select 1 -- depois');

    expect(count.queries).toBe(2);
    expect(count.control).toBe(2);
    expect(count.driver).toBe(0);
    expect(count.statements).toEqual(['select a from b', 'select c from d']);
  });

  it('fecha a janela mesmo quando o trabalho falha', async () => {
    const counter = createQueryCounter();

    await expect(
      counter.measure(async () => {
        counter.record('select 1');
        throw new Error('rota falhou');
      }),
    ).rejects.toThrow('rota falhou');

    const { count } = await counter.measure(async () => {
      counter.record('select 2');
    });
    expect(count.queries).toBe(1);
  });

  it('recusa medições aninhadas, que contariam a mesma consulta duas vezes', async () => {
    const counter = createQueryCounter();

    await expect(
      counter.measure(async () => {
        await counter.measure(async () => undefined);
      }),
    ).rejects.toThrow('não se aninham');
  });
});
