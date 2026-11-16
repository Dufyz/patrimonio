import { describe, expect, it } from 'vitest';

import { applyRetention } from './retention.js';
import type { BackupEntry } from './retention.js';

const entriesFrom = (dates: readonly string[]): BackupEntry[] =>
  dates.map((date) => ({ name: `patrimonio-${date}.dump.age`, date }));

/** Um dump por dia, do mais recente para trás. */
const daily = (from: string, days: number): BackupEntry[] => {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);

  for (let index = 0; index < days; index += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return entriesFrom(dates);
};

describe('retenção escalonada', () => {
  it('mantém todos os sete últimos dias', () => {
    const plan = applyRetention(daily('2026-10-06', 7), '2026-10-06');

    expect(plan.keep).toHaveLength(7);
    expect(plan.remove).toEqual([]);
  });

  it('além dos sete dias, mantém um por semana nas últimas quatro semanas', () => {
    const plan = applyRetention(daily('2026-10-06', 60), '2026-10-06');

    // 7 diários + 4 semanais + 2 mensais (setembro e agosto, pelo alcance).
    expect(plan.keep).toHaveLength(13);
    expect(plan.remove.length).toBe(60 - 13);
  });

  it('mantém um por mês nos últimos seis meses', () => {
    // Um dump por mês, dez meses para trás.
    const monthly = entriesFrom([
      '2026-10-06',
      '2026-09-30',
      '2026-08-31',
      '2026-07-31',
      '2026-06-30',
      '2026-05-31',
      '2026-04-30',
      '2026-03-31',
      '2026-02-28',
      '2026-01-31',
    ]);

    const plan = applyRetention(monthly, '2026-10-06');

    // O de hoje pelo diário, mais seis mensais.
    expect(plan.keep).toContain('patrimonio-2026-10-06.dump.age');
    expect(plan.keep).toHaveLength(7);
    expect(plan.remove).toEqual([
      'patrimonio-2026-03-31.dump.age',
      'patrimonio-2026-02-28.dump.age',
      'patrimonio-2026-01-31.dump.age',
    ]);
  });

  it('dentro da semana mantém o mais recente, não o primeiro', () => {
    const plan = applyRetention(
      entriesFrom(['2026-10-06', '2026-09-21', '2026-09-23', '2026-09-25']),
      '2026-10-06',
    );

    // A semana de 21 a 27 de setembro: fica o dia 25.
    expect(plan.keep).toContain('patrimonio-2026-09-25.dump.age');
    expect(plan.remove).toContain('patrimonio-2026-09-21.dump.age');
    expect(plan.remove).toContain('patrimonio-2026-09-23.dump.age');
  });

  it('bucket vazio não produz remoção', () => {
    expect(applyRetention([], '2026-10-06')).toEqual({ keep: [], remove: [] });
  });

  it('nada do que foi mantido aparece também na remoção', () => {
    const plan = applyRetention(daily('2026-10-06', 200), '2026-10-06');
    const kept = new Set(plan.keep);

    expect(plan.remove.some((name) => kept.has(name))).toBe(false);
    expect(plan.keep.length + plan.remove.length).toBe(200);
  });

  it('a política é 7 diários, 4 semanais e 6 mensais, e não mais que isso', () => {
    const plan = applyRetention(daily('2026-10-06', 400), '2026-10-06');

    expect(plan.keep.length).toBeLessThanOrEqual(7 + 4 + 6);
    expect(plan.keep.length).toBeGreaterThanOrEqual(7 + 4);
  });
});
