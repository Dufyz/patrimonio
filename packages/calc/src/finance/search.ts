import type { FinSnapshot } from '@patrimonio/domain';

import { cardSummary } from './cards.js';
import { dec, money } from './money.js';
import { byLedgerOrder, ledgerPool } from './ledger.js';
import { sourceName } from './lookup.js';
import { accountBalance } from './accounts.js';
import { fold, looseAmount, matchesText } from './text.js';

/**
 * Busca global: lançamentos, contas, cartões, categorias e recorrentes, agrupados
 * por tipo, com o total de cada grupo e um teto de resultados. Casa por texto
 * (sem acento nem caixa) e por valor, com ou sem formatação.
 */

export const SEARCH_LIMIT = 5;

export type SearchGroupId =
  'lancamentos' | 'contas' | 'cartoes' | 'categorias' | 'recorrentes';

export type SearchItem = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly amount: string | null;
  readonly date: string | null;
};

export type SearchGroup = {
  readonly id: SearchGroupId;
  readonly label: string;
  readonly total: number;
  readonly items: readonly SearchItem[];
};

export const searchFinance = (
  data: FinSnapshot,
  query: string,
  today: string,
  limit = SEARCH_LIMIT,
): readonly SearchGroup[] => {
  const q = query.trim();
  if (q === '') return [];
  const amount = looseAmount(q);
  const equalsAmount = (value: string): boolean =>
    amount !== null && dec(value).eq(amount);

  const entries = ledgerPool(data)
    .filter(
      (entry) =>
        matchesText(q, [
          entry.description,
          data.categories.find((c) => c.id === entry.category_id)?.name,
        ]) || equalsAmount(entry.amount),
    )
    .sort(byLedgerOrder);

  const accounts = data.accounts.filter(
    (account) =>
      matchesText(q, [account.name, account.institution]) ||
      equalsAmount(money(accountBalance(data, account.id, today))),
  );

  const cards = data.cards.filter((card) => matchesText(q, [card.name, card.last4]));
  const categories = data.categories.filter((category) =>
    matchesText(q, [category.name]),
  );
  const recurrings = data.recurrings.filter(
    (recurring) => matchesText(q, [recurring.name]) || equalsAmount(recurring.amount),
  );

  const groups: SearchGroup[] = [
    {
      id: 'lancamentos',
      label: 'Lançamentos',
      total: entries.length,
      items: entries.slice(0, limit).map((entry) => ({
        id: entry.id,
        title: entry.description,
        subtitle: `${data.categories.find((c) => c.id === entry.category_id)?.name ?? ''} · ${entry.payments
          .map((p) => sourceName(data, { type: p.source_type, id: p.source_id }))
          .join(' + ')}`,
        amount: entry.kind === 'despesa' ? `-${entry.amount}` : entry.amount,
        date: entry.date,
      })),
    },
    {
      id: 'contas',
      label: 'Contas',
      total: accounts.length,
      items: accounts.slice(0, limit).map((account) => ({
        id: account.id,
        title: account.name,
        subtitle: account.institution ?? account.type,
        amount: money(accountBalance(data, account.id, today)),
        date: null,
      })),
    },
    {
      id: 'cartoes',
      label: 'Cartões',
      total: cards.length,
      items: cards.slice(0, limit).map((card) => ({
        id: card.id,
        title: card.name,
        subtitle: card.last4 === '' ? 'Cartão' : `final ${card.last4}`,
        amount: cardSummary(data, card, today).used,
        date: null,
      })),
    },
    {
      id: 'categorias',
      label: 'Categorias',
      total: categories.length,
      items: categories.slice(0, limit).map((category) => ({
        id: category.id,
        title: category.name,
        subtitle: category.kind === 'despesa' ? 'Despesa' : 'Receita',
        amount: null,
        date: null,
      })),
    },
    {
      id: 'recorrentes',
      label: 'Recorrentes',
      total: recurrings.length,
      items: recurrings.slice(0, limit).map((recurring) => ({
        id: recurring.id,
        title: recurring.name,
        subtitle: `dia ${recurring.day} · ${recurring.mode}`,
        amount: recurring.amount,
        date: null,
      })),
    },
  ];

  return groups.filter((group) => group.total > 0);
};

export { fold };
