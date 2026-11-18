import { SkeletonRegion, SkeletonTable } from '../../components/skeleton.js';
import type { OverviewResource } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useMemo } from 'react';
import { Link } from 'react-router';

import { fetchCardsOverview } from '../../api/cards_overview.js';
import { usePortfolios } from '../../components/portfolios_provider.js';
import { Panel } from '../../components/primitives.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { Amount } from '../../finance/components/amount.js';
import type { FinanceData } from '../../finance/domain/types.js';
import { accountsTotal } from '../../finance/domain/cash_flow.js';
import type { IsoDate } from '../../finance/lib/dates.js';
import { allocatePercentTenths, formatPercentTenths } from '../../finance/lib/format.js';
import { decimalToCents } from '../../finance/lib/money.js';
import type { Cents } from '../../finance/lib/money.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { formatDate } from '../../lib/overview.js';
import { routes } from '../../lib/routes.js';
import { ALL_SCOPE } from '../../lib/scope.js';
import { useResource } from '../../lib/use_resource.js';

/**
 * VGR-02 · O painel Patrimônio da Visão geral · Tudo, na forma da prancha 1.1:
 * uma tabela Linha · Valor · Peso. Investimentos (com as carteiras embaixo) e
 * Em contas somam o Patrimônio total; Faturas a pagar e Livre após faturas ficam
 * dentro da tabela, mas **não descontam** do total (RN-U2, RN-U3). Carteira ainda
 * não consolidada vira traço, nunca zero.
 */

const Muted = ({ children }: { readonly children: React.ReactNode }) => (
  <span className="text-ink-3">{children}</span>
);

type Line = {
  readonly key: string;
  readonly label: string;
  readonly note?: React.ReactNode;
  readonly to?: string | undefined;
  /** `null` é traço: o valor ainda não existe. */
  readonly cents: Cents | null;
  /** Peso em décimos de ponto; ausente, a coluna fica vazia. */
  readonly weight?: number | undefined;
  readonly level: 'group' | 'detail';
  readonly negative?: boolean;
  /** O valor em vermelho (livre zerado por falta). */
  readonly alert?: boolean;
};

const LineRow = ({ line }: { readonly line: Line }): React.ReactElement => {
  const detail = line.level === 'detail';
  const label =
    line.to === undefined ? (
      line.label
    ) : (
      <Link to={line.to} className="cursor-pointer hover:text-accent hover:underline">
        {line.label}
      </Link>
    );
  return (
    <tr className="border-t border-line">
      <th
        scope="row"
        className={`py-[var(--row-pad)] pr-3 text-left font-[inherit] ${
          detail ? 'pl-9 font-normal text-ink-2' : 'pl-3 font-semibold'
        }`}
      >
        {label}
        {line.note === undefined ? null : (
          <span className="block text-xs font-normal text-ink-3">{line.note}</span>
        )}
      </th>
      <td
        className={`tabular px-3 py-[var(--row-pad)] text-right ${
          detail ? '' : 'font-semibold'
        } ${line.alert === true ? 'text-negative' : ''}`}
      >
        {line.cents === null ? (
          <Muted>—</Muted>
        ) : (
          <Amount cents={(line.negative === true ? -line.cents : line.cents) as Cents} />
        )}
      </td>
      <td className="tabular px-3 py-[var(--row-pad)] text-right text-ink-2">
        {line.weight === undefined ? null : formatPercentTenths(line.weight)}
      </td>
    </tr>
  );
};

export const PatrimonioPanel = ({
  data,
  today,
  overview,
  loading = false,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
  /** A leitura de Todas as carteiras; nula enquanto não chega ou se falhou. */
  readonly overview: OverviewResource | null;
  /** Enquanto a leitura não chega, o painel é esqueleto (nunca traço nem zero). */
  readonly loading?: boolean;
}): React.ReactElement => {
  const { slugs } = usePortfolios();
  const cards = useResource((signal) => fetchCardsOverview(signal), []);
  const inAccounts = useMemo(() => accountsTotal(data, today), [data, today]);

  const consolidated = overview !== null && overview.reference_date !== null;
  const investments: Cents | null =
    overview === null
      ? null
      : overview.reference_date === null
        ? null
        : (decimalToCents(overview.totals.value ?? '0') ?? 0);
  const total: Cents | null =
    investments === null ? null : ((inAccounts + investments) as Cents);
  const wallets = overview === null || !consolidated ? [] : overview.by_portfolio;

  // Pesos sobre o patrimônio, em décimos que somam 1000 (RN-64): Investimentos é
  // a soma das carteiras, então a linha-mãe fecha com as filhas.
  const tenths = allocatePercentTenths([
    Math.max(0, inAccounts),
    ...wallets.map((row) => Math.max(0, decimalToCents(row.value) ?? 0)),
  ]);
  const accountTenths = tenths[0] ?? 0;
  const walletTenths = tenths.slice(1);
  const investmentTenths = walletTenths.reduce((acc, value) => acc + value, 0);

  const wealth = cards.state.kind === 'ready' ? cards.state.value.wealth : null;
  const owed = wealth === null ? null : (decimalToCents(wealth.total_devido) ?? 0);
  const free = wealth === null ? null : (decimalToCents(wealth.livre) ?? 0);
  const lacking = wealth === null ? 0 : (decimalToCents(wealth.falta) ?? 0);

  const lines: readonly Line[] = [
    {
      key: 'investimentos',
      label: 'Investimentos',
      note:
        overview?.reference_date == null
          ? undefined
          : `consolidação ${formatDate(overview.reference_date as DateOnly)}`,
      to: routes.home('investimentos', ALL_SCOPE),
      cents: investments,
      weight: investments === null ? undefined : investmentTenths,
      level: 'group',
    },
    ...wallets.map((row, index): Line => ({
      key: row.portfolio_id,
      label: `Carteira ${row.name}`,
      to: routes.home('investimentos', slugs.get(row.portfolio_id) ?? ALL_SCOPE),
      cents: (decimalToCents(row.value) ?? 0) as Cents,
      weight: walletTenths[index] ?? 0,
      level: 'detail',
    })),
    {
      key: 'contas',
      label: 'Em contas',
      note: `saldo de ${formatDate(today as DateOnly).slice(0, 5)}`,
      to: financeRoutes.accounts(),
      cents: inAccounts,
      weight: accountTenths,
      level: 'group',
    },
    {
      key: 'faturas',
      label: 'Faturas a pagar',
      to: financeRoutes.cards(),
      cents: owed as Cents | null,
      negative: true,
      level: 'detail',
    },
    {
      key: 'livre',
      label: 'Livre após faturas',
      note:
        lacking > 0 ? (
          <>
            faltam <Amount cents={lacking as Cents} />
          </>
        ) : undefined,
      to: financeRoutes.cards(),
      cents: free as Cents | null,
      alert: lacking > 0,
      level: 'detail',
    },
  ];

  if (loading || cards.state.kind === 'loading') {
    return (
      <Panel
        title="Patrimônio"
        action={<span className="text-xs text-ink-3">valores em reais</span>}
        className="flex flex-col"
      >
        <SkeletonRegion label="Carregando o patrimônio">
          <SkeletonTable rows={6} columns={3} />
        </SkeletonRegion>
      </Panel>
    );
  }

  return (
    <Panel
      title="Patrimônio"
      action={<span className="text-xs text-ink-3">valores em reais</span>}
      className="flex flex-col"
    >
      <FinTable caption="Composição do patrimônio" fill>
        <THead>
          <Th>Linha</Th>
          <Th align="right">Valor</Th>
          <Th align="right">Peso</Th>
        </THead>
        <tbody>
          {lines.map((line) => (
            <LineRow key={line.key} line={line} />
          ))}
          <tr aria-hidden="true" className="h-full">
            <td colSpan={3} />
          </tr>
          <tr className="border-t border-line-2 bg-panel-2 font-semibold">
            <th scope="row" className="py-[var(--row-pad)] pl-3 text-left font-[inherit]">
              Patrimônio total
            </th>
            <td className="tabular px-3 py-[var(--row-pad)] text-right text-base">
              {total === null ? <Muted>—</Muted> : <Amount cents={total} />}
            </td>
            <td className="tabular px-3 py-[var(--row-pad)] text-right">
              {total === null ? <Muted>—</Muted> : '100%'}
            </td>
          </tr>
        </tbody>
      </FinTable>
    </Panel>
  );
};
