import { ARRAY_OID } from '../support/array_oid.js';
import type { Connection } from '../postgresql.js';
import { calendarFromSeed, readHolidaySeed } from './business_days.js';

export type LoadReport = { readonly rows: number; readonly years: string };

/**
 * Carrega o calendário numa escrita só, por `unnest`: 13 mil linhas em uma
 * consulta, não num laço de `await`. Reescreve o dia que já existe, o que
 * torna a carga repetível depois de uma correção na seed.
 *
 * Todo `sql.array` leva o OID do array explícito. Sem ele o driver adivinha o
 * tipo pelo primeiro elemento e manda o tipo escalar — o Postgres recusa com
 * "cannot cast type boolean to boolean[]" no booleano e com "malformed array
 * literal" na data, e a carga do calendário nunca chegava a rodar.
 */
export const loadBusinessDays = async (sql: Connection): Promise<LoadReport> => {
  const calendar = await calendarFromSeed();
  const seed = await readHolidaySeed();

  await sql`
    insert into business_day (
      calendar_date, is_business_day, is_bank_holiday, is_trading_holiday, holiday_name
    )
    select *
      from unnest(
        ${sql.array(
          calendar.map((row) => row.calendar_date),
          ARRAY_OID.date,
        )}::date[],
        ${sql.array(
          calendar.map((row) => row.is_business_day),
          ARRAY_OID.boolean,
        )}::boolean[],
        ${sql.array(
          calendar.map((row) => row.is_bank_holiday),
          ARRAY_OID.boolean,
        )}::boolean[],
        ${sql.array(
          calendar.map((row) => row.is_trading_holiday),
          ARRAY_OID.boolean,
        )}::boolean[],
        ${sql.array(
          calendar.map((row) => row.holiday_name),
          ARRAY_OID.text,
        )}::text[]
      )
    on conflict (calendar_date) do update set
      is_business_day    = excluded.is_business_day,
      is_bank_holiday    = excluded.is_bank_holiday,
      is_trading_holiday = excluded.is_trading_holiday,
      holiday_name       = excluded.holiday_name
  `;

  return { rows: calendar.length, years: `${seed.first_year}–${seed.last_year}` };
};
