import { dedupeKey } from '@patrimonio/domain';
import type { OutboxEventDraft } from '@patrimonio/domain';
import { describe, expect, it } from 'vitest';

import { coalesces, createDebouncePolicy } from './debounce.js';

const FIXED = new Date('2026-10-06T12:00:00.000Z');

const policy = createDebouncePolicy({ waitMs: 2_000, maxMs: 15_000 }, () => FIXED);

const recalc: OutboxEventDraft = {
  stage: 'recalc',
  dedupe_key: dedupeKey.recalc('cart-1'),
  payload: { portfolio_id: 'cart-1', from_date: '2015-03-12' },
};

describe('quem espera e quem não espera', () => {
  it('recálculo e mercado coalescem: eles chegam em rajada', () => {
    expect(coalesces('recalc')).toBe(true);
    expect(coalesces('market')).toBe(true);
  });

  it('fechamento, alertas, importação e backup não esperam: já têm hora', () => {
    expect(coalesces('close')).toBe(false);
    expect(coalesces('alerts')).toBe(false);
    expect(coalesces('import')).toBe(false);
    expect(coalesces('backup')).toBe(false);
  });

  it('o estágio que não coalesce passa intacto', () => {
    const draft: OutboxEventDraft = {
      stage: 'close',
      dedupe_key: dedupeKey.close('2026-10-06'),
      payload: { reference_date: '2026-10-06' },
    };

    expect(policy(draft)).toBe(draft);
  });
});

describe('a espera e o teto', () => {
  it('o recálculo nasce com espera e com teto contado do primeiro pedido', () => {
    const decorated = policy(recalc);

    expect(decorated.available_at?.toISOString()).toBe('2026-10-06T12:00:02.000Z');
    expect(decorated.debounce_until?.toISOString()).toBe('2026-10-06T12:00:15.000Z');
  });

  it('o teto é sempre depois da espera: sem isso a espera nunca seria renovada', () => {
    const decorated = policy(recalc);

    expect(decorated.debounce_until!.getTime()).toBeGreaterThan(
      decorated.available_at!.getTime(),
    );
  });

  it('cada pedido da rajada empurra a espera, e o teto acompanha o relógio', () => {
    let now = FIXED;
    const moving = createDebouncePolicy({ waitMs: 2_000, maxMs: 15_000 }, () => now);

    const first = moving(recalc);

    now = new Date(FIXED.getTime() + 1_000);
    const second = moving(recalc);

    // O segundo pedido pede uma espera maior; é o `least(..., debounce_until)` da
    // outbox que impede a rajada de adiar o recálculo para sempre.
    expect(second.available_at!.getTime()).toBeGreaterThan(
      first.available_at!.getTime(),
    );
  });

  it('data já declarada pelo plano vence a política', () => {
    const scheduled = new Date('2026-10-07T03:00:00.000Z');

    expect(
      policy({ ...recalc, available_at: scheduled }).available_at?.toISOString(),
    ).toBe(scheduled.toISOString());
  });

  it('o payload e a chave não são tocados: só as datas entram', () => {
    const decorated = policy(recalc);

    expect(decorated.dedupe_key).toBe(recalc.dedupe_key);
    expect(decorated.payload).toEqual(recalc.payload);
  });
});
