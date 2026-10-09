import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERIOD,
  addMonths,
  decodePeriod,
  encodePeriod,
  endOfMonth,
  formatRange,
  resolvePeriod,
  startOfMonth,
  startOfYear,
} from './period.js';

/** O "hoje" das pranchas: 6 de outubro de 2026. */
const HOJE = '2026-10-06';

describe('período', () => {
  it('o mês começa no dia 1 e vai até hoje', () => {
    expect(resolvePeriod({ kind: 'preset', preset: 'mes' }, HOJE, null)).toEqual({
      from: '2026-10-01',
      to: HOJE,
    });
  });

  it('o mês anterior é o mês inteiro, não os últimos trinta dias', () => {
    expect(resolvePeriod({ kind: 'preset', preset: 'mes_anterior' }, HOJE, null)).toEqual(
      { from: '2026-09-01', to: '2026-09-30' },
    );
  });

  it('o ano até hoje começa em janeiro', () => {
    expect(resolvePeriod({ kind: 'preset', preset: 'ytd' }, HOJE, null).from).toBe(
      '2026-01-01',
    );
  });

  it('doze meses contam doze meses, não 365 dias', () => {
    expect(resolvePeriod({ kind: 'preset', preset: '12m' }, HOJE, null)).toEqual({
      from: '2025-10-07',
      to: HOJE,
    });
  });

  it('"início" usa a data do primeiro lançamento da carteira', () => {
    expect(
      resolvePeriod({ kind: 'preset', preset: 'inicio' }, HOJE, '2021-03-15').from,
    ).toBe('2021-03-15');
  });

  it('carteira sem lançamento nenhum não inventa um começo', () => {
    expect(resolvePeriod({ kind: 'preset', preset: 'inicio' }, HOJE, null)).toEqual({
      from: HOJE,
      to: HOJE,
    });
  });

  it('a data não escorrega um dia por causa de fuso', () => {
    // Em São Paulo, `new Date('2026-10-01')` é 30/09 às 21h. O primeiro dia do
    // mês precisa continuar sendo o dia 1.
    expect(startOfMonth('2026-10-01')).toBe('2026-10-01');
    expect(startOfYear('2026-01-01')).toBe('2026-01-01');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });

  it('somar mês encurta no mês mais curto em vez de transbordar', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('o período personalizado aparece no botão como intervalo', () => {
    expect(formatRange({ from: '2026-09-01', to: '2026-10-06' }, HOJE)).toBe(
      '01/09 – 06/10',
    );
  });

  it('o intervalo que cruza o ano mostra o ano', () => {
    expect(formatRange({ from: '2025-11-01', to: '2026-10-06' }, HOJE)).toBe(
      '01/11/25 – 06/10',
    );
  });

  it('o período cabe na URL e volta igual', () => {
    const custom = { kind: 'custom', from: '2026-09-01', to: '2026-10-06' } as const;
    expect(decodePeriod(encodePeriod(custom))).toEqual(custom);
    expect(decodePeriod(encodePeriod({ kind: 'preset', preset: 'ytd' }))).toEqual({
      kind: 'preset',
      preset: 'ytd',
    });
  });

  it('período ilegível na URL volta ao padrão em vez de esvaziar a tela', () => {
    expect(decodePeriod('sempre')).toEqual(DEFAULT_PERIOD);
    expect(decodePeriod('2026-10-06..2026-09-01')).toEqual(DEFAULT_PERIOD);
    expect(decodePeriod('2026-13-01..2026-10-06')).toEqual(DEFAULT_PERIOD);
    expect(decodePeriod(null)).toEqual(DEFAULT_PERIOD);
  });
});
