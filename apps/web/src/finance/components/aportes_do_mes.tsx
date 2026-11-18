import { Link } from 'react-router';

import { fetchBook } from '../../api/book.js';
import { fetchPortfolios } from '../../api/portfolios.js';
import { MoneyChange } from '../../components/number.js';
import { Panel } from '../../components/primitives.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { useResource } from '../../lib/use_resource.js';
import type { FinanceData } from '../domain/types.js';
import type { IsoDate } from '../lib/dates.js';
import { formatDay } from '../lib/format.js';
import { financeRoutes } from '../lib/routes.js';
import { EmptyPanel, PanelError, PanelLoading } from './states.js';

/**
 * Aportes do mês (prancha 1.2): de que conta cada aporte sai e para qual carteira
 * vai, lançado e previsto. O aporte é despesa financeira: sai da conta, mas não
 * entra no consumo. O total é o do livro (RN-U16).
 */
export const AportesDoMesPanel = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
}): React.ReactElement => {
  const month = today.slice(0, 7);
  const book = useResource(
    (signal) => fetchBook({ month, tipo: ['APORTE'], limit: 100 }, signal),
    [month],
  );
  const portfolios = useResource((signal) => fetchPortfolios(signal), []);
  const state = book.state;

  const accountName = (id: string | null): string =>
    data.accounts.find((account) => account.id === id)?.name ?? '—';
  const portfolioName = (id: string | null): string =>
    portfolios.state.kind === 'ready'
      ? (portfolios.state.value.portfolios.find((p) => p.id === id)?.name ?? '—')
      : '…';

  let body: React.ReactElement;
  if (state.kind === 'loading') {
    body = <PanelLoading label="Carregando os aportes do mês" rows={2} columns={3} />;
  } else if (state.kind !== 'ready') {
    body = (
      <PanelError title="Não foi possível carregar os aportes" onRetry={book.reload} />
    );
  } else {
    const rows = state.value.rows.filter((row) => row.account_id !== null);
    body =
      rows.length === 0 ? (
        <EmptyPanel message="Nenhum aporte neste mês." />
      ) : (
        <FinTable caption="Aportes do mês">
          <THead>
            <Th>Dia</Th>
            <Th>Origem → Carteira</Th>
            <Th align="right">Valor (R$)</Th>
          </THead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="tabular px-3 py-[var(--row-pad)] text-ink-3">
                  {formatDay(row.date as IsoDate, today)}
                </td>
                <td className="px-3 py-[var(--row-pad)]">
                  {accountName(row.account_id)}{' '}
                  <span aria-hidden="true" className="text-ink-3">
                    →
                  </span>{' '}
                  {portfolioName(row.portfolio_id)}
                  {row.situation === 'previsto' ? (
                    <span className="ml-1 text-xs text-ink-3">previsto</span>
                  ) : null}
                </td>
                <td className="tabular px-3 py-[var(--row-pad)] text-right text-accent">
                  <MoneyChange value={`-${row.amount ?? '0'}`} tone="neutral" bare />
                </td>
              </tr>
            ))}
            <tr className="border-t border-line-strong bg-panel-2 font-semibold">
              <th
                scope="row"
                className="px-3 py-[var(--row-pad)] text-left font-[inherit]"
              >
                <Link
                  to={financeRoutes.entries('tipo=APORTE')}
                  className="hover:underline"
                >
                  Total
                </Link>
              </th>
              <td />
              <td className="tabular px-3 py-[var(--row-pad)] text-right text-accent">
                <MoneyChange
                  value={`-${state.value.totals.projetado.aportes}`}
                  tone="neutral"
                />
              </td>
            </tr>
          </tbody>
        </FinTable>
      );
  }
  return (
    <Panel title="Aportes do mês" className="flex-1">
      {body}
    </Panel>
  );
};
