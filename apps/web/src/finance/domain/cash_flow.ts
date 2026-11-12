import { compareDates, endOfMonth, startOfMonth } from '../lib/dates.js';
import type { IsoDate } from '../lib/dates.js';
import { sum } from '../lib/money.js';
import type { Cents } from '../lib/money.js';
import { openInvoicesTotal, cardSummary } from './cards.js';
import type { CashEvent, ProjectionDay } from './projection.js';
import { plannedEntries, projectBalance } from './projection.js';
import { accountsOverview } from './accounts.js';
import { indicators, isPosted } from './ledger.js';
import type { Entry, FinanceData } from './types.js';

/**
 * FVG-001 e GER-004 · O saldo previsto em contas e o fluxo do mês.
 *
 * Saldo previsto numa data = Em contas hoje + receitas previstas até a data −
 * despesas previstas até a data − pagamentos de fatura até a data (RN-50). Só
 * previstos entram: o que já foi lançado está no saldo de hoje. Compras
 * previstas no cartão saem da conta no vencimento da fatura, não na compra.
 *
 * Esta é a única função que calcula o saldo previsto: Finanças e Geral leem o
 * mesmo resultado, para que o número seja igual nas duas telas (RN-70).
 */

export type CashOutlook = {
  readonly today: IsoDate;
  readonly horizon: IsoDate;
  /** Em contas hoje: toda conta ativa soma (RN-30). */
  readonly startCents: Cents;
  /** Receitas previstas até o horizonte. */
  readonly entradasCents: Cents;
  /** Despesas previstas e faturas a pagar até o horizonte (positivo). */
  readonly saidasCents: Cents;
  /** O saldo previsto ao fim do horizonte. */
  readonly endCents: Cents;
  /** `endCents − startCents`. */
  readonly variationCents: Cents;
  readonly lowest: ProjectionDay;
  readonly days: readonly ProjectionDay[];
  readonly events: readonly CashEvent[];
};

export const cashOutlook = (
  data: FinanceData,
  today: IsoDate,
  horizon: IsoDate,
): CashOutlook => {
  const projection = projectBalance(data, today, horizon);
  const entradas = sum(
    projection.events.filter((event) => event.cents > 0).map((event) => event.cents),
  );
  const saidas = sum(
    projection.events.filter((event) => event.cents < 0).map((event) => -event.cents),
  );
  return {
    today,
    horizon,
    startCents: projection.startCents,
    entradasCents: entradas,
    saidasCents: saidas,
    endCents: projection.endCents,
    variationCents: projection.endCents - projection.startCents,
    lowest: projection.lowest,
    days: projection.days,
    events: projection.events,
  };
};

/**
 * Até onde o saldo previsto olha por padrão: o último dia do mês seguinte, o
 * que dá ao gráfico mais de um mês de futuro.
 */
export const defaultHorizon = (today: IsoDate): IsoDate => {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const next =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return endOfMonth(next);
};

/** A categoria dos aportes. Identificada pelo nome até existir marca de sistema (INT-001). */
export const INVESTMENT_CATEGORY = /^investimentos?$/u;

export const investmentCategoryIds = (data: FinanceData): ReadonlySet<string> =>
  new Set(
    data.categories
      .filter(
        (category) =>
          category.kind === 'despesa' &&
          INVESTMENT_CATEGORY.test(
            category.name.normalize('NFD').replace(/[̀-ͯ]/gu, '').trim().toLowerCase(),
          ),
      )
      .map((category) => category.id),
  );

export type MonthFlow = {
  readonly today: IsoDate;
  /** O último dia do mês. */
  readonly monthEnd: IsoDate;
  /** O saldo previsto em contas ao fim do mês (a mesma função de FVG-001). */
  readonly saldoPrevistoCents: Cents;
  /** Receitas do mês: lançadas mais previstas até o fim do mês. */
  readonly receitasCents: Cents;
  /** Receitas ainda previstas até o fim do mês. */
  readonly receitasPrevistasCents: Cents;
  /** Despesas já lançadas no mês. */
  readonly despesasRealizadasCents: Cents;
  /** Despesas ainda previstas até o fim do mês, sem as faturas. */
  readonly despesasPrevistasCents: Cents;
  /**
   * Parte das despesas previstas que vai para investir (categoria Investimentos).
   * Não é uma parcela a mais no saldo: já está dentro de `despesasPrevistasCents`.
   */
  readonly aportesPrevistosCents: Cents;
  /** Faturas que vencem até o fim do mês e saem da conta. */
  readonly faturasAPagarCents: Cents;
  readonly nextInvoiceDue: IsoDate | null;
  readonly emContasCents: Cents;
  readonly faturasAbertasCents: Cents;
};

export const monthFlow = (data: FinanceData, today: IsoDate): MonthFlow => {
  const monthEnd = endOfMonth(today);
  const outlook = cashOutlook(data, today, monthEnd);
  const range = { from: startOfMonth(today), to: monthEnd };

  const posted = data.entries.filter(isPosted);
  const flows = indicators(posted, range);

  const planned = plannedEntries(data, today, monthEnd).filter(
    (entry) => entry.historical !== true && !isOnCard(data, entry),
  );
  const investing = investmentCategoryIds(data);
  const previstas = planned.filter((entry) => entry.kind === 'despesa');
  const receitasPrevistas = sum(
    planned.filter((entry) => entry.kind === 'receita').map((entry) => entry.cents),
  );

  const faturas = outlook.events.filter((event) => event.type === 'fatura');
  const summaries = data.cards.map((card) => cardSummary(data, card, today));
  const owing = summaries.filter((item) => item.usedCents > 0);

  return {
    today,
    monthEnd,
    saldoPrevistoCents: outlook.endCents,
    receitasCents: flows.receitas.cents + receitasPrevistas,
    receitasPrevistasCents: receitasPrevistas,
    despesasRealizadasCents: flows.despesas.cents,
    despesasPrevistasCents: sum(previstas.map((entry) => entry.cents)),
    aportesPrevistosCents: sum(
      previstas
        .filter((entry) => investing.has(entry.categoryId))
        .map((entry) => entry.cents),
    ),
    faturasAPagarCents: sum(faturas.map((event) => -event.cents)),
    nextInvoiceDue: owing.map((item) => item.invoice.due).sort(compareDates)[0] ?? null,
    emContasCents: outlook.startCents,
    faturasAbertasCents: openInvoicesTotal(summaries),
  };
};

/** Um lançamento no cartão sai da conta só no vencimento da fatura. */
const isOnCard = (data: FinanceData, entry: Entry): boolean =>
  entry.payments.some((payment) =>
    data.cards.some((card) => card.id === payment.sourceId),
  );

/** O total em contas hoje, para quem só precisa dele (Geral, composição). */
export const accountsTotal = (data: FinanceData, today: IsoDate): Cents =>
  accountsOverview(
    data,
    { from: startOfMonth(today), to: endOfMonth(today) },
    today,
    false,
  ).totalBalance;
