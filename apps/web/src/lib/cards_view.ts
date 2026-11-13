import type { CardRowResource } from '../api/cards_overview.js';
import { scaled, unscaled } from './statement_view.js';

/** CRT-01 · O que a tela de Cartões decide sobre o que a api devolve. */
export type PayerGroup = {
  readonly accountId: string;
  readonly cards: readonly CardRowResource[];
  /** A soma das faturas (aberta + fechada a pagar) dos cartões do grupo. */
  readonly due: string;
};

const dueOf = (row: CardRowResource): bigint =>
  scaled(row.debt.abertas) + scaled(row.debt.fechadas_a_pagar);

export const groupByPayer = (rows: readonly CardRowResource[]): readonly PayerGroup[] => {
  const groups = new Map<string, CardRowResource[]>();
  for (const row of rows) {
    const list = groups.get(row.card.pay_account_id) ?? [];
    list.push(row);
    groups.set(row.card.pay_account_id, list);
  }
  return [...groups].map(([accountId, cards]) => ({
    accountId,
    cards,
    due: unscaled(cards.reduce((acc, c) => acc + dueOf(c), 0n)),
  }));
};

/** "Itaú Unibanco paga 3 cartões". */
export const payerTitle = (name: string, count: number): string =>
  `${name} paga ${count} ${count === 1 ? 'cartão' : 'cartões'}`;

/** "hoje", "amanhã", "em 5 dias" ou "venceu há 2 dias". */
export const dueIn = (days: number): string =>
  days === 0
    ? 'hoje'
    : days === 1
      ? 'amanhã'
      : days > 1
        ? `em ${days} dias`
        : `venceu há ${-days} ${days === -1 ? 'dia' : 'dias'}`;

/** O vencimento mais próximo entre os cartões, ou null. */
export const nextDue = (rows: readonly CardRowResource[]): string | null =>
  rows
    .map((r) => r.debt.next_due)
    .filter((d): d is string => d !== null)
    .sort()[0] ?? null;

/** Dias entre duas datas ISO (b − a). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Barra de limite: a porcentagem nunca passa de 100 na barra, mas o número é o real. */
export const barWidth = (percent: number): number => Math.min(100, Math.max(0, percent));

const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/** "2026-11" → "nov/2026". */
export const monthLabel = (key: string): string =>
  `${MONTHS[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7)}/${key.slice(0, 4)}`;

const STATUS_LABEL: Readonly<Record<string, string>> = {
  prevista: 'Prevista',
  aberta: 'Aberta',
  fechada: 'Fechada',
  parcial: 'Parcialmente paga',
  paga: 'Paga',
};

/** A situação como aparece na lista; "Venceu" ganha destaque quando passou do vencimento. */
export const invoiceStatusLabel = (status: string, overdue: boolean): string =>
  overdue ? 'Venceu' : (STATUS_LABEL[status] ?? status);

/** "dd/mm" de uma data ISO. */
export const shortDate = (iso: string): string => `${iso.slice(8)}/${iso.slice(5, 7)}`;

/** "paga em dd/mm · Itaú Unibanco", pelo último pagamento. */
export const paidNote = (
  payments: readonly { readonly date: string; readonly account_id: string }[],
  accountName: (id: string) => string,
): string | null => {
  const last = [...payments].sort((a, b) => a.date.localeCompare(b.date)).pop();
  return last === undefined
    ? null
    : `paga em ${shortDate(last.date)} · ${accountName(last.account_id)}`;
};
