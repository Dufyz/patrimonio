import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calendarFromSeed, readHolidaySeed } from '../seeds/business_days.js';
import {
  EXCEPTIONS,
  FIRST_YEAR,
  LAST_YEAR,
  buildCalendar,
  holidaysBetween,
} from '../seeds/holidays.js';

/**
 * As duas metades da conferência do calendário.
 *
 *   `pnpm holidays:report [ano]`    imprime o ano para comparar com o oficial
 *   `pnpm holidays:generate`        reescreve a seed a partir das regras
 *
 * O relatório é o que você põe lado a lado com o arquivo da ANBIMA e com o
 * calendário de negociação da B3. A geração é o que transforma uma correção em
 * `EXCEPTIONS` no arquivo que vai para o banco.
 */
const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const seedPath = (): string =>
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'seeds',
    'business_day_holidays.json',
  );

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const weekdayOf = (date: string): string =>
  WEEKDAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()] ?? '?';

const report = async (year: number): Promise<void> => {
  const calendar = await calendarFromSeed();
  const ofYear = calendar.filter((row) => row.calendar_date.startsWith(`${year}-`));

  if (ofYear.length === 0) {
    process.stderr.write(`${year} está fora do período coberto pela seed\n`);
    process.exit(1);
  }

  const tradingDays = ofYear.filter((row) => row.is_business_day).length;
  const bankDays = ofYear.filter(
    (row) =>
      !row.is_bank_holiday &&
      ![0, 6].includes(new Date(`${row.calendar_date}T00:00:00.000Z`).getUTCDay()),
  ).length;

  write(`Calendário de ${year}`);
  write('');
  write(`  dias de pregão (is_business_day)     ${tradingDays}`);
  write(`  dias úteis bancários                 ${bankDays}`);
  write('');
  write('  data         dia   pregão  banco  nome');

  for (const row of ofYear) {
    if (row.holiday_name === null) continue;

    write(
      `  ${row.calendar_date}   ${weekdayOf(row.calendar_date)}   ` +
        `${row.is_trading_holiday ? 'fecha ' : 'abre  '}  ` +
        `${row.is_bank_holiday ? 'fecha' : 'abre '}  ${row.holiday_name}`,
    );
  }

  write('');
  write('Confira contra:');
  write('  · feriados bancários — arquivo de feriados nacionais da ANBIMA');
  write('  · dias de pregão — calendário de negociação da B3');
  write('');
  write(
    'Divergência encontrada vira uma linha em EXCEPTIONS, em ' +
      'packages/db/src/seeds/holidays.ts, e depois `pnpm holidays:generate`.',
  );
};

const generate = async (): Promise<void> => {
  const holidays = holidaysBetween();
  const previous = await readHolidaySeed().catch(() => null);

  await writeFile(
    seedPath(),
    `${JSON.stringify(
      {
        first_year: FIRST_YEAR,
        last_year: LAST_YEAR,
        source:
          'gerado de src/seeds/holidays.ts (regras + EXCEPTIONS) por `pnpm holidays:generate`; ' +
          'conferido contra o arquivo de feriados da ANBIMA e o calendário de negociação da B3',
        exceptions: EXCEPTIONS.length,
        holidays,
      },
      null,
      2,
    )}\n`,
  );

  const calendar = buildCalendar();
  const before = previous?.holidays.length ?? 0;

  write(`seed reescrita: ${holidays.length} feriados, ${calendar.length} dias`);
  write(`exceções conferidas aplicadas: ${EXCEPTIONS.length}`);

  if (previous !== null && before !== holidays.length) {
    write(`a lista mudou de ${before} para ${holidays.length} feriados`);
  }

  write('');
  write('Rode `pnpm seed:business-days` para levar a correção ao banco.');
};

const command = process.argv[2] ?? 'report';

if (command === 'generate') {
  await generate();
} else {
  await report(Number(process.argv[3] ?? new Date().getUTCFullYear()));
}
