import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';

import { Panel } from '../../components/primitives.js';
import { FillRow, FinTable, Row, Td, Th, THead } from '../../components/table_parts.js';
import { accountsOverview } from '../domain/accounts.js';
import { cardSummary, openInvoicesTotal } from '../domain/cards.js';
import type { FinanceData } from '../domain/types.js';
import type { IsoDate } from '../lib/dates.js';
import { endOfMonth, startOfMonth } from '../lib/dates.js';
import { formatDay } from '../lib/format.js';
import { financeRoutes } from '../lib/routes.js';
import { Amount } from './amount.js';
import { EmptyPanel } from './states.js';

/**
 * FVG-005 e FVG-006 · Faturas abertas e Contas, os painéis de Finanças que a
 * Visão geral mostra em Tudo e em Fluxo (prancha 1.1 e 1.2). Próximos
 * lançamentos, o terceiro, lê o livro do servidor e mora em
 * `proximos_lancamentos.tsx`.
 */

const LINK = 'cursor-pointer text-[0.8125rem] text-accent hover:underline';

/** O texto do cabeçalho e, quando a tela pede, o link para a página do painel. */
export const PanelHeaderAction = ({
  hint,
  more,
}: {
  readonly hint: string;
  readonly more?: PanelMore | undefined;
}): React.ReactElement => (
  <span className="flex items-baseline gap-3">
    <span className="text-xs text-ink-3">{hint}</span>
    {more === undefined ? null : (
      <Link to={more.to} className={LINK}>
        {more.label} →
      </Link>
    )}
  </span>
);

/** O link do cabeçalho que leva à página com mais detalhes. */
export type PanelMore = { readonly to: string; readonly label: string };

const TotalRow = ({
  label,
  to,
  colSpan,
  children,
}: {
  readonly label: string;
  readonly to: string;
  readonly colSpan: number;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <tr className="border-t border-line-2 bg-panel-2 font-semibold">
    <td className="px-3 py-[var(--row-pad)]" colSpan={colSpan}>
      <Link to={to} className="cursor-pointer hover:underline">
        {label}
      </Link>
    </td>
    <td className="tabular px-3 py-[var(--row-pad)] text-right">{children}</td>
  </tr>
);

/* -------------------------------------------------------------------------- */
/* FVG-005 · Faturas abertas                                                  */

export const FaturasAbertasPanel = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
}): React.ReactElement => {
  const summaries = useMemo(
    () => data.cards.map((card) => cardSummary(data, card, today)),
    [data, today],
  );
  const navigate = useNavigate();

  return (
    <Panel
      title="Faturas abertas"
      action={
        <span className="text-xs text-ink-3">
          {summaries.length} {summaries.length === 1 ? 'cartão' : 'cartões'}
        </span>
      }
      className="flex-1"
    >
      {summaries.length === 0 ? (
        <EmptyPanel message="Nenhum cartão cadastrado." />
      ) : (
        <FinTable caption="Faturas abertas" fill>
          <THead>
            <Th>Cartão</Th>
            <Th align="right">Aberta</Th>
            <Th align="right">Vence</Th>
          </THead>
          <tbody>
            {summaries.map((item) => (
              <Row
                key={item.card.id}
                label={item.card.name}
                onClick={() => void navigate(financeRoutes.card(item.card.id))}
              >
                <Td>{item.card.name}</Td>
                <Td numeric className="font-medium">
                  <Amount cents={item.usedCents} />
                </Td>
                <Td numeric className="text-ink-2">
                  {formatDay(item.invoice.due, today)}
                </Td>
              </Row>
            ))}
            <FillRow colSpan={3} />
            <tr className="border-t border-line-2 bg-panel-2 font-semibold">
              <td className="px-3 py-[var(--row-pad)]">
                <Link
                  to={financeRoutes.cards()}
                  className="cursor-pointer hover:underline"
                >
                  Total
                </Link>
              </td>
              <td className="tabular px-3 py-[var(--row-pad)] text-right">
                <Amount cents={openInvoicesTotal(summaries)} />
              </td>
              <td />
            </tr>
          </tbody>
        </FinTable>
      )}
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* FVG-006 · Contas                                                           */

export const ContasPanel = ({
  data,
  today,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
}): React.ReactElement => {
  const navigate = useNavigate();
  const overview = useMemo(
    () =>
      accountsOverview(
        data,
        { from: startOfMonth(today), to: endOfMonth(today) },
        today,
        false,
      ),
    [data, today],
  );

  return (
    <Panel
      title="Contas"
      action={<span className="text-xs text-ink-3">saldo de hoje</span>}
      className="flex-1"
    >
      {overview.accounts.length === 0 ? (
        <EmptyPanel message="Nenhuma conta cadastrada." />
      ) : (
        <FinTable caption="Contas" fill>
          <THead>
            <Th>Conta</Th>
            <Th align="right">Saldo</Th>
          </THead>
          <tbody>
            {overview.accounts.map((row) => (
              <Row
                key={row.account.id}
                label={row.account.name}
                onClick={() => void navigate(financeRoutes.account(row.account.id))}
              >
                <Td>{row.account.name}</Td>
                <Td numeric>
                  <Amount cents={row.balance} />
                </Td>
              </Row>
            ))}
            <FillRow colSpan={2} />
            <TotalRow label="Em contas" to={financeRoutes.accounts()} colSpan={1}>
              <Amount cents={overview.totalBalance} />
            </TotalRow>
          </tbody>
        </FinTable>
      )}
    </Panel>
  );
};
