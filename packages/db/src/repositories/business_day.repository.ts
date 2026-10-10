import type { BusinessDayRepository } from '@patrimonio/application';
import { parseBusinessDayFromDB } from '@patrimonio/domain';
import type { DateOnly } from '@patrimonio/domain';
import { failure, success } from '@patrimonio/shared';

import { getRepositoryError } from '../errors/repository-error.js';
import type { Connection } from '../postgresql.js';

type Row = Record<string, unknown>;

export const createBusinessDayRepository = (sql: Connection): BusinessDayRepository => ({
  listBetween: async (from: DateOnly, to: DateOnly) => {
    try {
      const rows = await sql<Row[]>`
        SELECT *
          FROM business_day
         WHERE calendar_date BETWEEN ${from} AND ${to}
         ORDER BY calendar_date
      `;

      return success(rows.map((row) => parseBusinessDayFromDB(row)));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  countBetween: async (from: DateOnly, to: DateOnly) => {
    try {
      const rows = await sql<{ total: string }[]>`
        SELECT COUNT(*)::TEXT AS total
          FROM business_day
         WHERE calendar_date BETWEEN ${from} AND ${to}
           AND is_business_day
      `;

      return success(Number(rows[0]?.total ?? 0));
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  isBusinessDay: async (date: DateOnly) => {
    try {
      const rows = await sql<{ is_business_day: boolean }[]>`
        SELECT is_business_day FROM business_day WHERE calendar_date = ${date}
      `;

      // Fora do calendário carregado a resposta é "não sei", e chutar aqui
      // produziria juro corrido errado em silêncio.
      const row = rows[0];
      if (row === undefined) {
        return failure(
          getRepositoryError(new Error(`data fora do calendário carregado: ${date}`)),
        );
      }

      return success(row.is_business_day);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  nextBusinessDay: async (date: DateOnly) => {
    try {
      const rows = await sql<{ calendar_date: string }[]>`
        SELECT calendar_date
          FROM business_day
         WHERE calendar_date > ${date}
           AND is_business_day
         ORDER BY calendar_date
         LIMIT 1
      `;

      return success(rows[0]?.calendar_date ?? null);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  /** Uma consulta: os próximos `days` dias úteis, e o último deles é a resposta. */
  shiftBusinessDays: async (date: DateOnly, days: number) => {
    if (days <= 0) return success(date);

    try {
      const rows = await sql<{ calendar_date: string }[]>`
        SELECT calendar_date
          FROM business_day
         WHERE calendar_date > ${date}
           AND is_business_day
         ORDER BY calendar_date
         LIMIT ${days}
      `;

      const last = rows[rows.length - 1]?.calendar_date;

      if (last === undefined) {
        return failure(
          getRepositoryError(new Error(`sem dias úteis no calendário depois de ${date}`)),
        );
      }

      return success(last);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },

  previousBusinessDay: async (date: DateOnly) => {
    try {
      const rows = await sql<{ calendar_date: string }[]>`
        SELECT calendar_date
          FROM business_day
         WHERE calendar_date < ${date}
           AND is_business_day
         ORDER BY calendar_date DESC
         LIMIT 1
      `;

      return success(rows[0]?.calendar_date ?? null);
    } catch (error) {
      return failure(getRepositoryError(error));
    }
  },
});
