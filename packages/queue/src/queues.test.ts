import { STAGES } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import { ALL_QUEUES, QUEUES, QUEUE_NAMES, SCHEDULE_TIMEZONE } from './queues.js';

describe('declaração das filas', () => {
  it('as seis filas estão declaradas, uma por estágio', () => {
    expect(Object.keys(QUEUES).sort()).toEqual([...STAGES].sort());
    expect(ALL_QUEUES).toHaveLength(6);
  });

  it('a concorrência vem da declaração, não do processor', () => {
    expect(QUEUES.recalc.concurrency).toBe(1);
    expect(QUEUES.market.concurrency).toBe(2);
    expect(QUEUES.close.concurrency).toBe(1);
    expect(QUEUES.alerts.concurrency).toBe(1);
    expect(QUEUES.import.concurrency).toBe(1);
    expect(QUEUES.backup.concurrency).toBe(1);
  });

  it('mercado, fechamento e alertas rodam em dia útil, na ordem do pipeline', () => {
    expect(QUEUES.market.schedule).toEqual(['30 18 * * 1-5', '0 9 * * 1-5']);
    expect(QUEUES.close.schedule).toEqual(['0 19 * * 1-5']);
    expect(QUEUES.alerts.schedule).toEqual(['15 19 * * 1-5']);
    expect(QUEUES.backup.schedule).toEqual(['0 3 * * *']);
  });

  it('recálculo e importação não têm agendamento: são sob demanda', () => {
    expect(QUEUES.recalc.schedule).toBeUndefined();
    expect(QUEUES.import.schedule).toBeUndefined();
  });

  it('o agendamento é em horário de São Paulo, não em UTC', () => {
    expect(SCHEDULE_TIMEZONE).toBe('America/Sao_Paulo');
  });

  it('o nome da fila é o nome do estágio', () => {
    for (const stage of STAGES) {
      expect(QUEUE_NAMES[stage]).toBe(stage);
    }
  });
});
