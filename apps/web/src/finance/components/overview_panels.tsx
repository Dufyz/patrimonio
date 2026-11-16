import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Panel } from '../../components/primitives.js';
import {
  CategoryMarker,
  FillRow,
  FinTable,
  Row,
  Td,
  Th,
  THead,
} from '../../components/table_parts.js';
import { cn } from '../../lib/cn.js';
import { LaunchPlannedDialog } from '../../views/ledger/launch_planned.js';
import { accountsOverview } from '../domain/accounts.js';
import { cardSummary, openInvoicesTotal } from '../domain/cards.js';
import { effectiveDate } from '../domain/projection.js';
import type { Entry, FinanceData } from '../domain/types.js';
import { categoryColor } from '../lib/category_colors.js';
import type { IsoDate } from '../lib/dates.js';
import { compareDates, endOfMonth, startOfMonth } from '../lib/dates.js';
import { formatDay } from '../lib/format.js';
import { limitTone } from '../lib/limit.js';
import { financeRoutes } from '../lib/routes.js';
import { Amount } from './amount.js';
import { formatPercentValue } from './limit_bar.js';
import { EmptyPanel } from './states.js';

/**
 * FVG-001 a FVG-006 · Os painéis da Visão geral de Finanças. Geral reaproveita
 * os mesmos componentes (GER-008), com os mesmos dados.
 */

const LINK = 'cursor-pointer text-[0.8125rem] text-accent hover:underline';

/* -------------------------------------------------------------------------- */
/* FVG-004 · Próximos lançamentos                                             */

const NEXT_ENTRIES = 9;

/** Os previstos, do mais próximo de hoje ao mais distante; os vencidos contam a partir de hoje (RN-13). */
export const plannedAhead = (data: FinanceData, today: IsoDate): readonly Entry[] =>
  data.entries
    .filter((entry) => entry.status === 'prevista' && entry.historical !== true)
    .sort(
      (a, b) =>
        compareDates(effectiveDate(a, today), effectiveDate(b, today)) ||
        compareDates(a.date, b.date) ||
        a.id.localeCompare(b.id),
    );

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

/** O link do cabeçalho que leva à página com mais detalhes (Geral usa). */
export type PanelMore = { readonly to: string; readonly label: string };

export const ProximosLancamentosPanel = ({
  data,
  today,
  more,
  onLaunched,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
  readonly more?: PanelMore | undefined;
  /** VGR-15 · Com isto, cada linha tem "Lançar" (abre o modal de LAN-06). */
  readonly onLaunched?: (() => void) | undefined;
}): React.ReactElement => {
  const [launching, setLaunching] = useState<Entry | null>(null);
  const planned = useMemo(() => plannedAhead(data, today), [data, today]);
  const shown = planned.slice(0, NEXT_ENTRIES);
  const sourceName = (entry: Entry): string => {
    const id = entry.payments[0]?.sourceId;
    return (
      data.accounts.find((account) => account.id === id)?.name ??
      data.cards.find((card) => card.id === id)?.name ??
      '—'
    );
  };

  return (
    <Panel
      title="Próximos lançamentos"
      action={
        <PanelHeaderAction
          hint="o que ainda vai sair e entrar"
          more={
            more ?? {
              to: financeRoutes.entries('situacao=previsto'),
              label: `Ver os ${planned.length} previstos`,
            }
          }
        />
      }
      className="h-full"
    >
      {shown.length === 0 ? (
        <EmptyPanel message="Nada previsto." />
      ) : (
        <>
          <FinTable caption="Próximos lançamentos" fill>
            <THead>
              <Th>Data</Th>
              <Th>Descrição</Th>
              <Th>Conta ou cartão</Th>
              <Th align="right">Valor</Th>
              {onLaunched === undefined ? null : <Th align="right">Ação</Th>}
            </THead>
            <tbody>
              {shown.map((entry) => {
                const category = data.categories.find(
                  (item) => item.id === entry.categoryId,
                );
                const overdue = compareDates(entry.date, today) < 0;
                return (
                  <Row key={entry.id}>
                    <Td numeric className={cn('!text-left', overdue && 'text-negative')}>
                      {formatDay(entry.date, today)}
                    </Td>
                    <Td className="font-medium">
                      <CategoryMarker
                        color={categoryColor(category?.color)}
                        name={entry.description}
                      />
                    </Td>
                    <Td className="text-ink-2">{sourceName(entry)}</Td>
                    <Td numeric>
                      <Amount
                        cents={entry.kind === 'receita' ? entry.cents : -entry.cents}
                        variant="flow"
                      />
                    </Td>
                    {onLaunched === undefined ? null : (
                      <Td className="text-right">
                        <button
                          type="button"
                          className="cursor-pointer text-accent hover:underline"
                          aria-label={`Lançar ${entry.description}`}
                          onClick={() => setLaunching(entry)}
                        >
                          Lançar
                        </button>
                      </Td>
                    )}
                  </Row>
                );
              })}
              <FillRow colSpan={onLaunched === undefined ? 4 : 5} />
            </tbody>
          </FinTable>
        </>
      )}
      {onLaunched === undefined ? null : (
        <LaunchPlannedDialog
          planned={
            launching === null
              ? null
              : {
                  id: launching.id,
                  description: launching.description,
                  date: launching.date,
                  cents: String(launching.cents),
                }
          }
          today={today}
          onClose={() => setLaunching(null)}
          onDone={onLaunched}
        />
      )}
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* FVG-005 · Faturas abertas                                                  */

export const FaturasAbertasPanel = ({
  data,
  today,
  more,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
  readonly more?: PanelMore | undefined;
}): React.ReactElement => {
  const summaries = useMemo(
    () => data.cards.map((card) => cardSummary(data, card, today)),
    [data, today],
  );
  const navigate = useNavigate();
  const owing = summaries.filter((item) => item.usedCents > 0);
  const closes = owing.map((item) => item.invoice.closing).sort(compareDates)[0];
  const due = owing.map((item) => item.invoice.due).sort(compareDates)[0];

  return (
    <Panel
      title="Faturas abertas"
      action={
        <PanelHeaderAction
          hint="posição de hoje · % do limite usado"
          more={more ?? { to: financeRoutes.cards(), label: 'Cartões' }}
        />
      }
      className="flex-1"
    >
      {summaries.length === 0 ? (
        <EmptyPanel message="Nenhum cartão cadastrado." />
      ) : (
        <>
          <FinTable caption="Faturas abertas" fill>
            <THead>
              <Th>Cartão</Th>
              <Th align="right">Fatura</Th>
              <Th align="right">Limite</Th>
            </THead>
            <tbody>
              {summaries.map((item) => {
                const tone = limitTone(item.usedPercent);
                return (
                  <Row
                    key={item.card.id}
                    label={item.card.name}
                    onClick={() => void navigate(financeRoutes.card(item.card.id))}
                  >
                    <Td>
                      <span className="font-medium">{item.card.name}</span>{' '}
                      <span className="tabular text-xs text-ink-3">
                        •••• {item.card.last4}
                      </span>
                    </Td>
                    <Td numeric>
                      <Amount cents={item.usedCents} />
                    </Td>
                    <Td numeric>
                      <span className="inline-flex items-center justify-end gap-2.5">
                        <span className="relative h-1 w-16 overflow-hidden rounded-full bg-line">
                          <span
                            data-tone={tone}
                            className={cn(
                              'absolute inset-y-0 left-0 rounded-full',
                              tone === 'ok'
                                ? 'bg-positive'
                                : tone === 'warn'
                                  ? 'bg-attention'
                                  : 'bg-negative',
                            )}
                            style={{ width: `${Math.min(100, item.usedPercent)}%` }}
                          />
                        </span>
                        <span className="tabular w-12 text-right text-[0.8125rem]">
                          {formatPercentValue(item.usedPercent)}
                        </span>
                      </span>
                    </Td>
                  </Row>
                );
              })}
              <FillRow colSpan={3} />
            </tbody>
          </FinTable>
          <footer className="flex items-baseline justify-between gap-3 border-t border-line px-4 py-3 text-xs text-ink-3">
            <span>
              {closes === undefined || due === undefined
                ? 'nenhuma fatura a pagar'
                : `fecham ${formatDay(closes, today)} · vencem ${formatDay(due, today)}`}
            </span>
            <span className="tabular text-[0.8125rem] font-semibold text-ink">
              <Amount cents={openInvoicesTotal(summaries)} />
            </span>
          </footer>
        </>
      )}
    </Panel>
  );
};

/* -------------------------------------------------------------------------- */
/* FVG-006 · Contas                                                           */

export const ContasPanel = ({
  data,
  today,
  more,
}: {
  readonly data: FinanceData;
  readonly today: IsoDate;
  readonly more?: PanelMore | undefined;
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
      action={
        <PanelHeaderAction
          hint="posição de hoje · saldo de cada conta"
          more={more ?? { to: financeRoutes.accounts(), label: 'Contas' }}
        />
      }
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
                <Td className="font-medium">{row.account.name}</Td>
                <Td numeric>
                  <Amount cents={row.balance} />
                </Td>
              </Row>
            ))}
            <FillRow colSpan={2} />
            <tr className="border-t border-line bg-panel-2 font-semibold">
              <td className="px-3 py-[var(--row-pad)]">
                <Link
                  to={financeRoutes.accounts()}
                  className="cursor-pointer hover:underline"
                >
                  Total em contas
                </Link>
              </td>
              <td className="tabular px-3 py-[var(--row-pad)] text-right">
                <Amount cents={overview.totalBalance} />
              </td>
            </tr>
          </tbody>
        </FinTable>
      )}
    </Panel>
  );
};
