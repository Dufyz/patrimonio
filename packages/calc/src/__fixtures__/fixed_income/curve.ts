import type { CurveInput, IndexFactor } from '../../fixed_income/curve.js';

/**
 * Fixtures da marcação na curva, conferidas à mão contra a convenção declarada
 * em `curve.ts`: período da aplicação inclusive à referência exclusive, dia útil
 * lido do calendário, truncamento em vez de arredondamento.
 */

/** Dias úteis como segunda a sexta, para os cenários que não testam feriado. */
export const weekdays = (from: string, count: number): readonly string[] => {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);

  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
};

const flat = (dates: readonly string[], dailyFactor: string): readonly IndexFactor[] =>
  dates.map((date) => ({ date, daily_factor: dailyFactor }));

/**
 * O calendário do primeiro cenário tem 4 de janeiro como feriado. É o que separa
 * dia útil de dia corrido: de 2 a 10 de janeiro são oito dias corridos e cinco
 * dias úteis, e o rendimento é o dos cinco.
 */
export const januaryWithHoliday: readonly string[] = [
  '2024-01-02',
  '2024-01-03',
  // 2024-01-04 é feriado neste calendário
  '2024-01-05',
  '2024-01-08',
  '2024-01-09',
  '2024-01-10',
  '2024-01-11',
  '2024-01-12',
];

/** Um dia de CDI com a Selic em torno de 10,65% ao ano. */
export const CDI_DAILY_FACTOR = '1.000401';

/** CDB a 112% do CDI num período com feriado: cinco dias úteis, não oito. */
export const cdbOver112: CurveInput = {
  principal: '10000.00',
  issued_at: '2024-01-02',
  reference_date: '2024-01-10',
  indexer: 'cdi_pct',
  rate: '112',
  business_days: januaryWithHoliday,
  index_factors: flat(januaryWithHoliday, CDI_DAILY_FACTOR),
};

/**
 * Prefixado a 11% ao ano por 252 dias úteis: o fator é exatamente 1,11, o que
 * prova que a composição é por dia útil sobre 252 e não linear sobre 365.
 */
export const prefixedOneYear: CurveInput = {
  principal: '10000.00',
  issued_at: '2024-01-02',
  reference_date: '2024-12-19',
  indexer: 'prefixed',
  rate: '11',
  business_days: weekdays('2024-01-02', 300),
};

const ipcaCalendar = weekdays('2024-02-01', 60);

/** IPCA + 6% ao ano: o índice do mês compõe com o cupom, por dia útil. */
export const ipcaPlusSpread: CurveInput = {
  principal: '10000.00',
  issued_at: ipcaCalendar[0] ?? '2024-02-01',
  reference_date: ipcaCalendar[21] ?? '2024-03-01',
  indexer: 'ipca_plus',
  rate: '6',
  business_days: ipcaCalendar,
  index_factors: flat(ipcaCalendar.slice(0, 21), '1.000150'),
};

/**
 * O IPCA do mês corrente só sai no mês seguinte. Aqui os últimos seis dias úteis
 * não têm índice publicado: com projeção eles rendem e ficam marcados; sem ela
 * não rendem, e o fato é reportado em vez de virar rendimento inventado.
 */
export const ipcaAwaitingRelease: CurveInput = {
  principal: '10000.00',
  issued_at: ipcaCalendar[0] ?? '2024-02-01',
  reference_date: ipcaCalendar[21] ?? '2024-03-01',
  indexer: 'ipca_plus',
  rate: '6',
  business_days: ipcaCalendar,
  index_factors: flat(ipcaCalendar.slice(0, 15), '1.000150'),
  projected_daily_factor: '1.000150',
};
