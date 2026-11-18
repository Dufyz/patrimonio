import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { fetchBook, fetchCardNames, fetchCategoryOptions } from '../../api/book.js';
import type { CategoryOption } from '../../api/book.js';
import { usePortfolios } from '../../components/portfolios_provider.js';
import { Money } from '../../components/number.js';
import { Panel } from '../../components/primitives.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { EmptyPanel, PanelError, PanelLoading } from '../../finance/components/states.js';
import { addMonths } from '../../finance/lib/dates.js';
import type { IsoDate } from '../../finance/lib/dates.js';
import { formatDay } from '../../finance/lib/format.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { signOf } from '../../lib/ledger_book.js';
import { useResource } from '../../lib/use_resource.js';
import { LedgerKindTag, PartiesCell } from '../ledger/ledger_parts.js';
import type { PartyNames } from '../ledger/ledger_parts.js';

/**
 * CTA-01 · Últimas movimentações, como na prancha 3.1: o que acabou de ser lançado
 * em todas as contas, lido do livro (RN-U16). Quem quiser mais abre o livro.
 */
const SHOWN = 8;

export const RecentMovements = ({
  today,
  accounts,
}: {
  readonly today: IsoDate;
  readonly accounts: ReadonlyMap<string, string>;
}): React.ReactElement => {
  const since = addMonths(today, -2);
  const book = useResource(
    (signal) =>
      fetchBook({ from: since, to: today, situacao: ['lancado'], limit: SHOWN }, signal),
    [since, today],
  );
  const { portfolios } = usePortfolios();
  const [categories, setCategories] = useState<readonly CategoryOption[]>([]);
  const [cards, setCards] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    fetchCategoryOptions()
      .then(setCategories)
      .catch(() => undefined);
    fetchCardNames()
      .then(setCards)
      .catch(() => undefined);
  }, []);

  const names: PartyNames = {
    account: (id) => accounts.get(id) ?? null,
    card: (id) => cards.get(id) ?? null,
    portfolio: (id) => portfolios.find((p) => p.id === id)?.name ?? null,
    source: (id) => accounts.get(id) ?? cards.get(id) ?? null,
    out: (value) => `−${value.replace('-', '')}`,
  };

  const state = book.state;
  let body: React.ReactElement;
  if (state.kind === 'loading') {
    body = <PanelLoading label="Carregando as últimas movimentações" />;
  } else if (state.kind === 'error') {
    body = (
      <PanelError
        title="Não foi possível carregar as movimentações"
        onRetry={book.reload}
      />
    );
  } else if (state.value.rows.length === 0) {
    body = <EmptyPanel message="Nenhuma movimentação lançada ainda." />;
  } else {
    body = (
      <FinTable caption="Últimas movimentações">
        <THead>
          <Th>Descrição</Th>
          <Th>Tipo</Th>
          <Th className="max-lg:hidden">Categoria</Th>
          <Th className="max-xl:hidden">Conta / Carteira</Th>
          <Th align="right">Valor (R$)</Th>
        </THead>
        <tbody>
          {state.value.rows.map((row) => {
            const sign = signOf(row.kind);
            const payments =
              (row.entry as { payments?: readonly unknown[] } | null)?.payments ?? [];
            return (
              <tr key={row.id} className="border-t border-line">
                <td className="px-3 py-[var(--row-pad)] font-medium">
                  {row.description}
                  {payments.length > 1 ? (
                    <span className="ml-1.5 text-xs font-normal text-ink-3">
                      · {payments.length} origens
                    </span>
                  ) : null}
                  <span className="sr-only">{formatDay(row.date as IsoDate, today)}</span>
                </td>
                <td className="px-3 py-[var(--row-pad)]">
                  <LedgerKindTag kind={row.kind} planned={false} />
                </td>
                <td className="px-3 py-[var(--row-pad)] text-ink-2 max-lg:hidden">
                  {categories.find((c) => c.id === row.category_id)?.name ?? '—'}
                </td>
                <td className="px-3 py-[var(--row-pad)] max-xl:hidden">
                  <PartiesCell row={row} names={names} />
                </td>
                <td className="tabular px-3 py-[var(--row-pad)] text-right font-medium">
                  <span
                    className={
                      row.kind === 'RECEITA' || row.kind === 'PROVENTO'
                        ? 'text-positive'
                        : row.kind === 'APORTE'
                          ? 'text-accent'
                          : ''
                    }
                  >
                    {sign === '' ? null : (
                      <span aria-hidden="true">{sign === '-' ? '−' : '+'}</span>
                    )}
                    <Money value={row.amount ?? '0'} bare />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </FinTable>
    );
  }

  return (
    <Panel
      title="Últimas movimentações"
      hint={
        <Link
          to={financeRoutes.entries('situacao=lancado')}
          className="cursor-pointer text-[0.8125rem] text-accent hover:underline"
        >
          Ver em Movimentações
        </Link>
      }
      action={<span className="text-xs text-ink-3">todas as contas</span>}
    >
      {body}
    </Panel>
  );
};
