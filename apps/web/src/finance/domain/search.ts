import { formatBRL, formatDay } from '../lib/format.js';
import { financeRoutes } from '../lib/routes.js';
import { matchesSearch } from '../lib/text.js';
import { sourceName } from './sources.js';
import type { SearchItem as PaletteItem } from '../../lib/search.js';
import type { FinanceData } from './types.js';

/**
 * FIN-703 · Busca global (⌘K): o que o usuário digita acha um lançamento, uma
 * conta, um cartão, um recorrente ou uma categoria, e cada resultado já leva à
 * tela certa.
 */

export type SearchGroupId =
  'lancamentos' | 'contas' | 'cartoes' | 'recorrentes' | 'categorias';

export type SearchItem = {
  readonly id: string;
  readonly group: SearchGroupId;
  readonly label: string;
  readonly hint: string;
  readonly to: string;
};

export type SearchGroup = {
  readonly id: SearchGroupId;
  readonly title: string;
  /** Quantos resultados o grupo tem; `items` traz no máximo `SEARCH_LIMIT`. */
  readonly total: number;
  readonly items: readonly SearchItem[];
};

const TITLES: Readonly<Record<SearchGroupId, string>> = {
  lancamentos: 'Movimentações',
  contas: 'Contas',
  cartoes: 'Cartões',
  recorrentes: 'Recorrentes',
  categorias: 'Categorias',
};

export const SEARCH_LIMIT = 5;

/**
 * NAV-09 · O valor que a pessoa digitou, em centavos, ou nulo se o texto não é
 * um valor. Aceita "1234,56", "1.234,56", "R$ 1.234,56", "1234.56" e "1234".
 */
export const valueInCents = (query: string): number | null => {
  const text = query.replace(/R\$|\s/gu, '');
  if (!/^\d[\d.,]*$/u.test(text)) return null;
  const decimal = /,(\d{1,2})$/u.exec(text) ?? /^\d+\.(\d{1,2})$/u.exec(text);
  const whole = text
    .slice(0, decimal === null ? undefined : text.length - decimal[1]!.length - 1)
    .replace(/[.,]/gu, '');
  if (whole === '' || !/^\d+$/u.test(whole)) return null;
  const cents = decimal === null ? 0 : Number(decimal[1]!.padEnd(2, '0'));
  return Number(whole) * 100 + cents;
};

export const searchFinance = (
  data: FinanceData,
  query: string,
  today: string,
): readonly SearchGroup[] => {
  if (query.trim() === '') return [];
  const categoryName = (id: string): string =>
    data.categories.find((c) => c.id === id)?.name ?? '';

  const value = valueInCents(query);
  const groups: Record<SearchGroupId, SearchItem[]> = {
    lancamentos: data.entries
      .filter((entry) => entry.historical !== true)
      .filter(
        (entry) =>
          matchesSearch(query, [entry.description, categoryName(entry.categoryId)]) ||
          (value !== null && Math.abs(entry.cents) === value),
      )
      .toSorted((a, b) => b.date.localeCompare(a.date))
      .map((entry) => ({
        id: entry.id,
        group: 'lancamentos' as const,
        label: entry.description,
        hint: `${formatDay(entry.date, today)} · ${categoryName(entry.categoryId)} · ${formatBRL(entry.cents)}`,
        to: financeRoutes.entries(`busca=${encodeURIComponent(entry.description)}`),
      })),
    contas: data.accounts
      .filter((account) => matchesSearch(query, [account.name, account.role]))
      .map((account) => ({
        id: account.id,
        group: 'contas' as const,
        label: account.name,
        hint: 'Conta',
        to: financeRoutes.account(account.id),
      })),
    cartoes: data.cards
      .filter((card) => matchesSearch(query, [card.name, card.last4]))
      .map((card) => ({
        id: card.id,
        group: 'cartoes' as const,
        label: card.name,
        hint: `final ${card.last4} · paga com ${sourceName(data, card.payerId)}`,
        to: financeRoutes.card(card.id),
      })),
    recorrentes: data.recurrings
      .filter(
        (recurring) =>
          matchesSearch(query, [recurring.name, categoryName(recurring.categoryId)]) ||
          (value !== null && Math.abs(recurring.cents) === value),
      )
      .map((recurring) => ({
        id: recurring.id,
        group: 'recorrentes' as const,
        label: recurring.name,
        hint: `dia ${String(recurring.day).padStart(2, '0')} · ${formatBRL(recurring.cents)}`,
        to: financeRoutes.recurrings(),
      })),
    categorias: data.categories
      .filter((category) => matchesSearch(query, [category.name]))
      .map((category) => ({
        id: category.id,
        group: 'categorias' as const,
        label: category.name,
        hint: category.kind,
        to: financeRoutes.entries('agrupar=categoria'),
      })),
  };

  return (Object.keys(groups) as SearchGroupId[])
    .map((id) => ({
      id,
      title: TITLES[id],
      total: groups[id].length,
      items: groups[id].slice(0, SEARCH_LIMIT),
    }))
    .filter((group) => group.items.length > 0);
};

const GLYPHS: Readonly<Record<SearchGroupId, string>> = {
  lancamentos: 'swap',
  contas: 'bank',
  cartoes: 'card',
  recorrentes: 'repeat',
  categorias: 'tag',
};

/**
 * Os mesmos resultados, no formato da paleta global: a busca é uma só, e
 * Finanças entra nela como mais um grupo. O que a busca achou já vem filtrado.
 */
export const financeSearchItems = (
  data: FinanceData,
  query: string,
  today: string,
): readonly PaletteItem[] =>
  searchFinance(data, query, today)
    .flatMap((group) => [
      ...group.items,
      // O grupo mostra cinco; o resto está um clique adiante, com a busca aplicada.
      ...(group.total > group.items.length && group.id === 'lancamentos'
        ? [
            {
              id: 'ver-todos',
              group: group.id,
              label: `Ver todas as ${group.total} movimentações`,
              hint: `mostrando ${group.items.length} de ${group.total}`,
              to: financeRoutes.entries(`busca=${encodeURIComponent(query.trim())}`),
            } satisfies SearchItem,
          ]
        : []),
    ])
    .map((item): PaletteItem => ({
      id: `finance:${item.group}:${item.id}`,
      group: 'finance',
      glyph: GLYPHS[item.group],
      label: item.label,
      detail: item.hint,
      amount: null,
      shortcut: null,
      keywords: [],
      target: { kind: 'path', path: item.to },
      disabled: null,
    }));
