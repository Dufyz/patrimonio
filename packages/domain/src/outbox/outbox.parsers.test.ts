import { describe, expect, it } from 'vitest';

import { dedupeKey } from './outbox.entities.js';
import { parseOutboxEventFromDB } from './outbox.parsers.js';

const row = {
  id: '0191e5a0-0000-7000-8000-000000000001',
  stage: 'recalc',
  dedupe_key: 'recalc:longo-prazo',
  payload: { portfolio_id: 'longo-prazo', from_date: '2021-03-12' },
  available_at: new Date('2026-10-06T22:00:00.000Z'),
  debounce_until: new Date('2026-10-06T22:00:15.000Z'),
  dispatched_at: null,
  attempts: 0,
  failed_at: null,
  error: null,
  created_at: new Date('2026-10-06T21:59:59.000Z'),
};

describe('parseOutboxEventFromDB', () => {
  it('copia campo a campo e normaliza carimbo de tempo', () => {
    const event = parseOutboxEventFromDB(row);

    expect(event.stage).toBe('recalc');
    expect(event.available_at).toBe('2026-10-06T22:00:00.000Z');
    expect(event.debounce_until).toBe('2026-10-06T22:00:15.000Z');
    expect(event.dispatched_at).toBeNull();
    expect(event.attempts).toBe(0);
  });

  it('coluna nova no SELECT * não aparece na saída sem linha no parser', () => {
    const event = parseOutboxEventFromDB({ ...row, priority: 9 });

    expect(Object.keys(event)).not.toContain('priority');
  });

  it('estágio desconhecido estoura em vez de virar undefined silencioso', () => {
    expect(() => parseOutboxEventFromDB({ ...row, stage: 'reindex' })).toThrow(
      /estágio desconhecido/,
    );
  });
});

describe('dedupeKey', () => {
  it('a chave do recálculo não carrega a data, para a rajada coalescer', () => {
    expect(dedupeKey.recalc('longo-prazo')).toBe('recalc:longo-prazo');
  });

  it('as outras chaves seguem a tabela do pipeline', () => {
    expect(dedupeKey.backfill('itub4')).toBe('backfill:itub4');
    expect(dedupeKey.close('2026-10-06')).toBe('close:2026-10-06');
    expect(dedupeKey.import('abc')).toBe('import:abc');
    expect(dedupeKey.market('2026-10-06')).toBe('market:2026-10-06');
    expect(dedupeKey.alerts('2026-10-06')).toBe('alerts:2026-10-06');
    expect(dedupeKey.backup('2026-10-06')).toBe('backup:2026-10-06');
  });
});
