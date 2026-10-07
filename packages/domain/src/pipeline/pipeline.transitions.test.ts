import { describe, expect, it } from 'vitest';

import { STAGES } from './pipeline.entities.js';
import type { Stage, StageOutcome, Transition } from './pipeline.entities.js';
import { isPortfolioScoped, transition } from './pipeline.transitions.js';

/**
 * Uma linha por transição possível: seis estágios, quatro desfechos, e a falha
 * dividida entre transitória e definitiva. Cada linha é um teste.
 */
const LINES: ReadonlyArray<[Stage, StageOutcome, boolean | undefined, Transition]> = [
  ['recalc', 'requested', undefined, { recalc_status: 'queued', next: null }],
  ['recalc', 'started', undefined, { recalc_status: 'running', next: null }],
  ['recalc', 'succeeded', undefined, { recalc_status: 'idle', next: 'alerts' }],
  ['recalc', 'failed', true, { recalc_status: 'queued', next: 'recalc' }],
  ['recalc', 'failed', false, { recalc_status: 'failed', next: null }],

  ['market', 'requested', undefined, { recalc_status: 'idle', next: null }],
  ['market', 'started', undefined, { recalc_status: 'idle', next: null }],
  ['market', 'succeeded', undefined, { recalc_status: 'idle', next: 'close' }],
  ['market', 'failed', true, { recalc_status: 'idle', next: 'market' }],
  ['market', 'failed', false, { recalc_status: 'idle', next: null }],

  ['close', 'requested', undefined, { recalc_status: 'queued', next: null }],
  ['close', 'started', undefined, { recalc_status: 'running', next: null }],
  ['close', 'succeeded', undefined, { recalc_status: 'idle', next: 'alerts' }],
  ['close', 'failed', true, { recalc_status: 'queued', next: 'close' }],
  ['close', 'failed', false, { recalc_status: 'failed', next: null }],

  ['alerts', 'requested', undefined, { recalc_status: 'idle', next: null }],
  ['alerts', 'started', undefined, { recalc_status: 'idle', next: null }],
  ['alerts', 'succeeded', undefined, { recalc_status: 'idle', next: null }],
  ['alerts', 'failed', true, { recalc_status: 'idle', next: 'alerts' }],
  ['alerts', 'failed', false, { recalc_status: 'idle', next: null }],

  ['import', 'requested', undefined, { recalc_status: 'queued', next: null }],
  ['import', 'started', undefined, { recalc_status: 'running', next: null }],
  ['import', 'succeeded', undefined, { recalc_status: 'queued', next: 'recalc' }],
  ['import', 'failed', true, { recalc_status: 'queued', next: 'import' }],
  ['import', 'failed', false, { recalc_status: 'failed', next: null }],

  ['backup', 'requested', undefined, { recalc_status: 'idle', next: null }],
  ['backup', 'started', undefined, { recalc_status: 'idle', next: null }],
  ['backup', 'succeeded', undefined, { recalc_status: 'idle', next: null }],
  ['backup', 'failed', true, { recalc_status: 'idle', next: 'backup' }],
  ['backup', 'failed', false, { recalc_status: 'idle', next: null }],
];

describe('transition', () => {
  it.each(LINES)(
    '%s %s (recuperável: %s) leva a %o',
    (stage, outcome, recoverable, expected) => {
      const result =
        recoverable === undefined ? { stage, outcome } : { stage, outcome, recoverable };

      expect(transition(result)).toEqual(expected);
    },
  );

  it('a tabela cobre todo estágio e todo desfecho', () => {
    const outcomes: StageOutcome[] = ['requested', 'started', 'succeeded', 'failed'];

    for (const stage of STAGES) {
      for (const outcome of outcomes) {
        expect(transition({ stage, outcome })).toBeDefined();
      }
    }

    // 6 estágios × 4 desfechos, com a falha contada duas vezes.
    expect(LINES).toHaveLength(STAGES.length * 5);
  });

  it('o recálculo pede alertas no fim, para o painel refletir o número novo', () => {
    expect(transition({ stage: 'recalc', outcome: 'succeeded' }).next).toBe('alerts');
  });

  it('o fechamento diário só roda depois do mercado', () => {
    expect(transition({ stage: 'market', outcome: 'succeeded' }).next).toBe('close');
  });

  it('falha transitória volta para a própria fila; definitiva para o pipeline', () => {
    expect(transition({ stage: 'recalc', outcome: 'failed', recoverable: true })).toEqual(
      {
        recalc_status: 'queued',
        next: 'recalc',
      },
    );

    expect(
      transition({ stage: 'recalc', outcome: 'failed', recoverable: false }),
    ).toEqual({
      recalc_status: 'failed',
      next: null,
    });
  });

  it('só os estágios de escopo de carteira movem recalc_status', () => {
    expect(isPortfolioScoped('recalc')).toBe(true);
    expect(isPortfolioScoped('close')).toBe(true);
    expect(isPortfolioScoped('import')).toBe(true);
    expect(isPortfolioScoped('market')).toBe(false);
    expect(isPortfolioScoped('backup')).toBe(false);
    expect(isPortfolioScoped('alerts')).toBe(false);
  });
});
