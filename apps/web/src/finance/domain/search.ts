import { formatBRL, formatDay } from '../lib/format.js';
import { financeRoutes } from '../lib/routes.js';
import { matchesSearch } from '../lib/text.js';
import { sourceName } from './sources.js';
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
  readonly items: readonly SearchItem[];
};

const TITLES: Readonly<Record<SearchGroupId, string>> = {
  lancamentos: 'Lançamentos',
  contas: 'Contas',
  cartoes: 'Cartões',
  recorrentes: 'Recorrentes',
  categorias: 'Categorias',
};

export const SEARCH_LIMIT = 5;

export const searchFinance = (
  data: FinanceData,
  query: string,
  today: string,
): readonly SearchGroup[] => {
  if (query.trim() === '') return [];
  const categoryName = (id: string): string =>
    data.categories.find((c) => c.id === id)?.name ?? '';

  const groups: Record<SearchGroupId, SearchItem[]> = {
    lancamentos: data.entries
      .filter((entry) => entry.historical !== true)
      .filter((entry) =>
        matchesSearch(query, [entry.description, categoryName(entry.categoryId)]),
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
        hint: account.type === 'beneficio' ? 'Benefício' : 'Conta',
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
      .filter((recurring) =>
        matchesSearch(query, [recurring.name, categoryName(recurring.categoryId)]),
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
        to: financeRoutes.categories(),
      })),
  };

  return (Object.keys(groups) as SearchGroupId[])
    .map((id) => ({ id, title: TITLES[id], items: groups[id].slice(0, SEARCH_LIMIT) }))
    .filter((group) => group.items.length > 0);
};
