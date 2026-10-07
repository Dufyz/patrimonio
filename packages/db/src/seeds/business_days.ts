import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCalendarFromHolidays } from './holidays.js';
import type { CalendarRow, Holiday } from './holidays.js';

type SeedFile = {
  readonly first_year: number;
  readonly last_year: number;
  readonly source: string;
  /** Quantas divergências conferidas as regras já absorveram. */
  readonly exceptions?: number;
  readonly holidays: readonly Holiday[];
};

const seedPath = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));

  return here.includes(join('dist', 'seeds'))
    ? join(here, '..', '..', 'src', 'seeds', 'business_day_holidays.json')
    : join(here, 'business_day_holidays.json');
};

export const readHolidaySeed = async (): Promise<SeedFile> =>
  JSON.parse(await readFile(seedPath(), 'utf8')) as SeedFile;

/**
 * O calendário que vai para o banco: vem do JSON versionado, não das regras em
 * código. Uma correção da ANBIMA se resolve editando o arquivo.
 */
export const calendarFromSeed = async (): Promise<CalendarRow[]> => {
  const seed = await readHolidaySeed();

  return buildCalendarFromHolidays(seed.holidays, seed.first_year, seed.last_year);
};
