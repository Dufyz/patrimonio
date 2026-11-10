import { describe, expect, it } from 'vitest';

import { sum } from '../lib/money.js';
import {
  effectiveDate,
  plannedEntries,
  projectBalance,
  projectedMonths,
  realizedBalances,
  startingBalance,
  upcomingEvents,
} from './projection.js';
import { SEED_REFERENCE_DATE, seedData } from './seed.js';
import type { Entry } from './types.js';

const data = seedData();
const TODAY = SEED_REFERENCE_DATE;
const HORIZON = '2026-12-31';

describe('projeção de saldo', () => {
  const projection = projectBalance(data, TODAY, HORIZON);

  it('parte do saldo em contas de hoje', () => {
    expect(startingBalance(data, TODAY)).toBe(1258385);
    expect(projection.startCents).toBe(1258385);
    expect(projection.days[0]).toEqual({ date: TODAY, cents: 1258385 });
  });

  it('o saldo final é o inicial mais a soma dos eventos', () => {
    expect(projection.endCents).toBe(
      projection.startCents + sum(projection.events.map((event) => event.cents)),
    );
    expect(projection.days[projection.days.length - 1]?.date).toBe(HORIZON);
    expect(projection.events[projection.events.length - 1]?.balanceAfter).toBe(
      projection.endCents,
    );
  });

  it('eventos em ordem de data; o saldo corrido bate evento a evento', () => {
    let running = projection.startCents;
    let last = '';
    for (const event of projection.events) {
      expect(event.date >= last).toBe(true);
      last = event.date;
      running += event.cents;
      expect(event.balanceAfter).toBe(running);
    }
  });

  it('o menor saldo é o menor dia, e o primeiro no empate', () => {
    const min = Math.min(...projection.days.map((day) => day.cents));
    expect(projection.lowest.cents).toBe(min);
    expect(projection.days.find((day) => day.cents === min)?.date).toBe(
      projection.lowest.date,
    );
    const lastOnDay = projection.events.filter((e) => e.date === projection.lowest.date);
    if (lastOnDay.length > 0) {
      expect(projection.lowestEventId).toBe(lastOnDay[lastOnDay.length - 1]?.id);
    }
  });

  it('fatura sai da conta pagadora no vencimento, não na compra (RN-50)', () => {
    const nubank = projection.events.find((e) => e.id === 'fatura:nubank-master:2026-11');
    expect(nubank?.date).toBe('2026-11-05');
    expect(nubank?.accountId).toBe('nubank-conta');
    expect(nubank?.type).toBe('fatura');
    expect(nubank?.cents).toBeLessThan(0);
    const itau = projection.events.find((e) => e.id === 'fatura:itau-visa:2026-10');
    expect(itau?.date).toBe('2026-10-30');
  });

  it('fatura não aparece duas vezes e a já paga não entra', () => {
    const ids = projection.events.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);
    const paid = new Set(data.payments.map((p) => `fatura:${p.cardId}:${p.invoice}`));
    for (const id of ids) expect(paid.has(id)).toBe(false);
  });

  it('períodos cobrem hoje até o horizonte e somam os eventos', () => {
    expect(projection.periods.map((p) => p.key)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(projection.periods[0]?.from).toBe(TODAY);
    expect(projection.periods[2]?.to).toBe(HORIZON);
    for (const period of projection.periods) {
      expect(period.saidas).toBe(period.despesas + period.faturas);
    }
    expect(projection.periods[2]?.endCents).toBe(projection.endCents);
    const delta = sum(projection.periods.map((p) => p.entradas - p.saidas));
    expect(projection.startCents + delta).toBe(projection.endCents);
  });

  it('não altera os dados nem os totais reais (RN-02)', () => {
    const before = JSON.stringify(data);
    projectBalance(data, TODAY, HORIZON);
    expect(JSON.stringify(data)).toBe(before);
    expect(startingBalance(data, TODAY)).toBe(1258385);
  });
});

describe('previstos', () => {
  it('previsto vencido conta a partir de hoje (RN-13)', () => {
    const entry = { date: '2026-10-01' } as Entry;
    expect(effectiveDate(entry, TODAY)).toBe(TODAY);
    expect(effectiveDate({ date: '2026-11-02' } as Entry, TODAY)).toBe('2026-11-02');
  });

  it('recorrente ganha uma ocorrência virtual por mês, sem repetir o que já existe', () => {
    const planned = plannedEntries(data, TODAY, HORIZON);
    const salary = planned.filter((entry) => entry.recurringId === 'r-salario');
    expect(salary.map((entry) => entry.date.slice(0, 7))).toEqual(
      expect.arrayContaining(['2026-11', '2026-12']),
    );
    const months = salary.map((entry) => entry.date.slice(0, 7));
    expect(new Set(months).size).toBe(months.length);
  });

  it('mês pulado não é regenerado (RN-06)', () => {
    const skipped = { ...data, skips: [...(data.skips ?? []), 'r-salario:2026-11'] };
    const planned = plannedEntries(skipped, TODAY, HORIZON);
    expect(
      planned.some((e) => e.recurringId === 'r-salario' && e.date.startsWith('2026-11')),
    ).toBe(false);
  });

  it('recorrente inativo não projeta', () => {
    const off = {
      ...data,
      recurrings: data.recurrings.map((r) =>
        r.id === 'r-salario' ? { ...r, active: false } : r,
      ),
    };
    expect(
      plannedEntries(off, TODAY, HORIZON).some((e) => e.id.startsWith('v-r-salario')),
    ).toBe(false);
  });
});

describe('meses projetados', () => {
  const months = projectedMonths(data, TODAY, 3);
  it('do mês de hoje até 3 meses à frente', () => {
    expect(months.map((m) => m.key)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
    expect(months[1]?.receitas).toBeGreaterThan(0);
    expect(months[1]?.despesas).toBeGreaterThan(0);
  });
});

describe('realizado e próximos dias', () => {
  it('o realizado termina no saldo de hoje', () => {
    const days = realizedBalances(data, '2026-10-01', TODAY);
    expect(days[0]?.date).toBe('2026-10-01');
    expect(days[days.length - 1]).toEqual({ date: TODAY, cents: 1258385 });
  });

  it('próximos 30 dias só traz eventos dentro da janela', () => {
    const projection = projectBalance(data, TODAY, HORIZON);
    const next = upcomingEvents(projection, 30);
    expect(next.length).toBeGreaterThan(0);
    for (const event of next) expect(event.date <= '2026-11-23').toBe(true);
  });
});
