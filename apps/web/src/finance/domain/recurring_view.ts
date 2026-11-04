import type { Category, Recurring } from './types.js';
import { sourceName } from './sources.js';
import { formatBRL } from '../lib/format.js';

/** "Itaú Corrente" ou "Flex + Itaú Corrente". */
export const paymentLabel = (recurring: Recurring): string =>
  recurring.secondSourceId === undefined
    ? sourceName(recurring.sourceId)
    : `${sourceName(recurring.sourceId)} + ${sourceName(recurring.secondSourceId)}`;

/** "Flex cobre até R$ 150,00", só quando há duas origens. */
export const paymentNote = (recurring: Recurring): string | null =>
  recurring.secondSourceId === undefined || recurring.coversUpTo === undefined
    ? null
    : `${sourceName(recurring.sourceId)} cobre até ${formatBRL(recurring.coversUpTo)}`;

export const MODE_LABEL = { automatico: 'automático', manual: 'manual' } as const;

/** Dentro de cada seção, pela data do mês; empate pelo nome. */
export const byDay = (a: Recurring, b: Recurring): number =>
  a.day - b.day || a.name.localeCompare(b.name, 'pt-BR');

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
