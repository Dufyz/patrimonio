import { Decimal } from 'decimal.js';

import { calendarDaysBetween } from '../support/dates.js';

/**
 * Rentabilidade de um ativo ao longo da vida: ponderada pelo tempo (TWR) e pelo
 * dinheiro (TIR). As duas existem porque respondem perguntas diferentes: a TWR
 * diz como o **ativo** andou, sem se importar com quando o dinheiro entrou; a TIR
 * diz como o **dinheiro** rendeu, e depende de quando se comprou e vendeu.
 */
const PCT_DP = 2;
const MIN_DAYS_XIRR = 30;

export type AssetDay = {
  /** `YYYY-MM-DD`, em ordem crescente. */
  readonly date: string;
  /** Valor da posição no fim do dia, já com as compras e vendas do dia. */
  readonly value: string;
  /** Dinheiro líquido que entrou no ativo no dia: compra positiva, venda negativa. */
  readonly flow: string;
  /** Proventos pagos no dia. */
  readonly income: string;
};

/**
 * Encadeia o retorno diário `(valor_fim − fluxo + provento) / valor_ontem − 1`.
 * Dia sem valor na véspera (abertura da posição) não tem base para dividir e não
 * entra: o dinheiro só começa a render no dia seguinte. Nulo quando nenhum dia
 * pôde ser medido.
 */
export const timeWeightedReturn = (days: readonly AssetDay[]): string | null => {
  let factor = new Decimal(1);
  let measured = false;
  let previous = new Decimal(0);

  for (const day of days) {
    const value = new Decimal(day.value);
    if (previous.gt(0)) {
      const gain = value.minus(new Decimal(day.flow)).plus(new Decimal(day.income));
      factor = factor.times(gain.dividedBy(previous));
      measured = true;
    }
    previous = value;
  }

  if (!measured) return null;
  return factor.minus(1).times(100).toDecimalPlaces(PCT_DP).toFixed(PCT_DP);
};

export type CashFlow = {
  readonly date: string;
  /** Positivo recebe (venda, provento, valor final); negativo paga (compra). */
  readonly amount: string;
};

const npv = (flows: readonly { years: number; amount: number }[], rate: number): number =>
  flows.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + rate, flow.years), 0);

/**
 * Taxa interna de retorno anualizada, em %, por bisseção. Nulo quando não há
 * troca de sinal (só saiu ou só entrou dinheiro) ou quando o prazo é curto demais:
 * anualizar um mês vira um número enorme que não diz nada.
 */
export const xirr = (flows: readonly CashFlow[]): string | null => {
  if (flows.length < 2) return null;
  const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0]!.date;
  const last = sorted[sorted.length - 1]!.date;
  if (calendarDaysBetween(first, last) < MIN_DAYS_XIRR) return null;

  const points = sorted.map((flow) => ({
    years: calendarDaysBetween(first, flow.date) / 365,
    amount: Number(flow.amount),
  }));
  if (!points.some((p) => p.amount < 0) || !points.some((p) => p.amount > 0)) return null;

  let low = -0.999;
  let high = 100;
  if (npv(points, low) * npv(points, high) > 0) return null;

  for (let step = 0; step < 200; step += 1) {
    const mid = (low + high) / 2;
    if (npv(points, low) * npv(points, mid) <= 0) high = mid;
    else low = mid;
  }

  const rate = (low + high) / 2;
  return new Decimal(rate).times(100).toDecimalPlaces(PCT_DP).toFixed(PCT_DP);
};
