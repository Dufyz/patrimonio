import type { Category, FinanceData, Recurring } from './types.js';
import { sourceName } from './sources.js';
import { paymentsFor } from './recurring.js';

/** "Itaú Corrente" ou "Flex + Itaú Corrente". */
export const paymentLabel = (data: FinanceData, recurring: Recurring): string =>
  recurring.secondSourceId === undefined
    ? sourceName(data, recurring.sourceId)
    : `${sourceName(data, recurring.sourceId)} + ${sourceName(data, recurring.secondSourceId)}`;

/** Quanto sai de cada origem no valor cheio do recorrente (uma linha por origem). */
export const paymentParts = (
  data: FinanceData,
  recurring: Recurring,
): readonly {
  readonly sourceId: string;
  readonly name: string;
  readonly cents: number;
}[] =>
  paymentsFor(recurring, recurring.cents).map((payment) => ({
    sourceId: payment.sourceId,
    name: sourceName(data, payment.sourceId),
    cents: payment.cents,
  }));

/** A conta do agrupamento: a origem que paga mais (RN-23). */
export const primarySourceOf = (recurring: Recurring): string =>
  paymentsFor(recurring, recurring.cents).reduce((a, b) => (b.cents > a.cents ? b : a))
    .sourceId;

/** Valor com sinal: receita positiva, despesa negativa. */
export const signedCents = (recurring: Recurring): number =>
  recurring.kind === 'receita' ? recurring.cents : -recurring.cents;

export const MODE_LABEL = { automatico: 'automático', manual: 'manual' } as const;

/** Dentro de cada seção, pela data do mês; empate pelo nome. */
/** Ativos primeiro, pelo dia do mês; os pausados ficam no fim da seção (prancha 05). */
export const byDay = (a: Recurring, b: Recurring): number =>
  Number(b.active) - Number(a.active) ||
  a.day - b.day ||
  a.name.localeCompare(b.name, 'pt-BR');

export const categoryOf = (
  categories: readonly Category[],
  recurring: Recurring,
): Category | undefined => categories.find((c) => c.id === recurring.categoryId);

/** "15 ativas · 1 pausada"; sem pausados, só as ativas. */
export const summaryLabel = (recurrings: readonly Recurring[]): string => {
  const active = recurrings.filter((r) => r.active).length;
  const paused = recurrings.length - active;
  const a = `${active} ${active === 1 ? 'ativa' : 'ativas'}`;
  return paused === 0 ? a : `${a} · ${paused} ${paused === 1 ? 'pausada' : 'pausadas'}`;
};
