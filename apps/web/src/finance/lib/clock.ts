import { saoPauloDate } from './dates.js';
import type { IsoDate } from './dates.js';

/**
 * "Hoje" de Finanças, no fuso America/Sao_Paulo.
 *
 * É a única fonte de "hoje" das telas e dos cálculos. Pode ser fixada — pela
 * URL (`?hoje=2026-10-24`) ou por um teste —, que é como se confere uma tela
 * contra as pranchas, desenhadas em 24/10/2026.
 */

let override: IsoDate | null = null;

export const setTodayOverride = (date: IsoDate | null): void => {
  override = date;
};

export const hasTodayOverride = (): boolean => override !== null;

export const today = (now: Date = new Date()): IsoDate => override ?? saoPauloDate(now);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Lê `?hoje=AAAA-MM-DD` da busca da URL, ou `null` quando ausente ou inválido. */
export const todayFromSearch = (search: string): IsoDate | null => {
  const value = new URLSearchParams(search).get('hoje');
  return value !== null && ISO.test(value) ? value : null;
};
