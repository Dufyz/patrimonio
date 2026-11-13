import { browserStorage, readEnum, writeRaw } from './preferences.js';
import type { Storageish } from './preferences.js';
import type { IsoDate } from '../finance/lib/dates.js';
import { currentMonth, last12Months, previousMonth } from '../finance/lib/period.js';
import type { DateRange } from '../finance/lib/period.js';

/**
 * CFG-02 · O que a pessoa escolhe para o app abrir do jeito dela: tela inicial,
 * escopo e período padrão, formato de data e primeiro dia da semana. Cada
 * escolha vale já e persiste por dispositivo (CMP-13); armazenamento
 * indisponível devolve o padrão, e o app funciona.
 */
export const HOME_SCREENS = [
  { value: 'visao-geral', label: 'Visão geral', path: '/' },
  { value: 'lancamentos', label: 'Lançamentos', path: '/lancamentos' },
  { value: 'contas', label: 'Contas', path: '/contas' },
  { value: 'cartoes', label: 'Cartões', path: '/cartoes' },
  { value: 'posicoes', label: 'Posições', path: '/carteiras/todas/posicoes' },
] as const;

export const HOME_SCOPES = [
  { value: 'tudo', label: 'Tudo' },
  { value: 'fluxo', label: 'Fluxo' },
  { value: 'investimentos', label: 'Investimentos' },
] as const;

export const DEFAULT_PERIODS = [
  { value: 'mes-corrente', label: 'Mês corrente' },
  { value: 'mes-anterior', label: 'Mês anterior' },
  { value: 'ultimos-12-meses', label: 'Últimos 12 meses' },
  { value: 'ano-ate-hoje', label: 'Ano até hoje' },
] as const;

export const DATE_FORMATS = [
  { value: 'br', label: 'dd/mm/aaaa' },
  { value: 'iso', label: 'aaaa-mm-dd (ISO)' },
] as const;

export const WEEK_STARTS = [
  { value: 'domingo', label: 'Domingo' },
  { value: 'segunda', label: 'Segunda-feira' },
] as const;

export type HomeScreen = (typeof HOME_SCREENS)[number]['value'];
export type HomeScope = (typeof HOME_SCOPES)[number]['value'];
export type DefaultPeriod = (typeof DEFAULT_PERIODS)[number]['value'];
export type DateFormat = (typeof DATE_FORMATS)[number]['value'];
export type WeekStart = (typeof WEEK_STARTS)[number]['value'];

export type DisplayPreferences = {
  readonly homeScreen: HomeScreen;
  readonly homeScope: HomeScope;
  readonly defaultPeriod: DefaultPeriod;
  readonly dateFormat: DateFormat;
  readonly weekStart: WeekStart;
};

export const DISPLAY_DEFAULTS: DisplayPreferences = {
  homeScreen: 'visao-geral',
  homeScope: 'tudo',
  defaultPeriod: 'mes-corrente',
  dateFormat: 'br',
  weekStart: 'domingo',
};

const key = (name: keyof DisplayPreferences): string => `patrimonio.display.${name}`;
const values = <T extends { readonly value: string }>(list: readonly T[]) =>
  list.map((item) => item.value) as readonly T['value'][];

export const readDisplay = (
  storage: Storageish | null = browserStorage(),
): DisplayPreferences => ({
  homeScreen: readEnum(
    storage,
    key('homeScreen'),
    values(HOME_SCREENS),
    DISPLAY_DEFAULTS.homeScreen,
  ),
  homeScope: readEnum(
    storage,
    key('homeScope'),
    values(HOME_SCOPES),
    DISPLAY_DEFAULTS.homeScope,
  ),
  defaultPeriod: readEnum(
    storage,
    key('defaultPeriod'),
    values(DEFAULT_PERIODS),
    DISPLAY_DEFAULTS.defaultPeriod,
  ),
  dateFormat: readEnum(
    storage,
    key('dateFormat'),
    values(DATE_FORMATS),
    DISPLAY_DEFAULTS.dateFormat,
  ),
  weekStart: readEnum(
    storage,
    key('weekStart'),
    values(WEEK_STARTS),
    DISPLAY_DEFAULTS.weekStart,
  ),
});

export const writeDisplay = <K extends keyof DisplayPreferences>(
  name: K,
  value: DisplayPreferences[K],
  storage: Storageish | null = browserStorage(),
): void => writeRaw(storage, key(name), value);

/** O período com que as telas de Finanças abrem. */
export const defaultRange = (period: DefaultPeriod, today: IsoDate): DateRange => {
  switch (period) {
    case 'mes-anterior':
      return previousMonth(today);
    case 'ultimos-12-meses':
      return last12Months(today);
    case 'ano-ate-hoje':
      return { from: `${today.slice(0, 4)}-01-01` as IsoDate, to: today };
    default:
      return currentMonth(today);
  }
};

/** O caminho em que `/` abre, dada a tela inicial escolhida. */
export const homePath = (screen: HomeScreen): string =>
  HOME_SCREENS.find((item) => item.value === screen)?.path ?? '/';

/** A URL da Visão geral no escopo padrão (NAV-01 lê o escopo da consulta). */
export const homeScopeSearch = (scope: HomeScope): string =>
  scope === 'fluxo'
    ? '?escopo=fluxo'
    : scope === 'investimentos'
      ? '?escopo=investimentos'
      : '';

/** `2026-10-05` → `05/10/2026` ou, no formato ISO, ele mesmo. */
export const formatFullDate = (
  iso: string,
  format: DateFormat = readDisplay().dateFormat,
): string => (format === 'iso' ? iso : iso.split('-').reverse().join('/'));
