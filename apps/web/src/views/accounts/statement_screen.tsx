import { useEffect, useMemo, useState } from 'react';
import type { BookRowResource } from '@patrimonio/contracts';
import { Link, useParams, useSearchParams } from 'react-router';

import { fetchAccountStatement } from '../../api/statement_view.js';
import type {
  AccountStatementResource,
  PlannedLineResource,
  StatementLineResource,
} from '../../api/statement_view.js';
import { NewEntryModal } from '../ledger/new_entry_modal.js';
import { fetchAccountNames } from '../../api/book.js';
import { fetchCategories } from '../../api/ledger_write.js';
import { FlowPeriodControl } from '../../components/period_control.js';
import { usePortfolios } from '../../components/portfolios_provider.js';
import { Money } from '../../components/number.js';
import { usePreferences } from '../../components/preferences.js';
import { Panel } from '../../components/primitives.js';
import {
  FilterBar,
  ToolbarIconButton,
  ToolbarSearch,
} from '../../components/filter_bar.js';
import { FinTable, Th, THead } from '../../components/table_parts.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { StatStrip } from '../../finance/components/stat_strip.js';
import { PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { downloadCsv } from '../../finance/lib/csv.js';
import type { IsoDate } from '../../finance/lib/dates.js';
import { formatMonth } from '../../finance/lib/format.js';
import { formatRange, isWholeMonth } from '../../finance/lib/period.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { formatMoney } from '../../lib/format.js';
import { dayMonth, statementCloses, STATEMENT_TYPES } from '../../lib/statement_view.js';
import { useFinancePeriod } from '../../finance/components/period_provider.js';
import { Arrow, LedgerKindTag } from '../ledger/ledger_parts.js';

/**
 * CTA-02 · Extrato, como na prancha 3.2: o que entrou e saiu de uma conta, do mais
 * novo ao mais antigo, com o saldo após cada linha. As linhas previstas ficam no
 * topo, listradas, e não mexem no saldo de hoje. Se saldo inicial + entradas −
 * saídas não fechar no saldo final, os números somem e o erro aparece no lugar.
 */
type Row = {
  readonly id: string;
  readonly date: string;
  readonly description: string;
  readonly note: string | null;
  readonly kind: string;
  readonly category_id: string | null;
  readonly amount: string;
  readonly balance_after: string;
  readonly planned: boolean;
  readonly from: string | null;
  readonly to: string | null;
  readonly portfolio_id: string | null;
  readonly tags: readonly string[];
};

const KIND_TO_LEDGER: Readonly<Record<string, BookRowResource['kind'] | null>> = {
  receita: 'RECEITA',
  despesa: 'DESPESA',
  transferencia: 'TRANSFERENCIA',
  fatura: 'PAGAMENTO_FATURA',
  aporte: 'APORTE',
  resgate: 'RESGATE',
  provento: 'PROVENTO',
  ajuste: null,
};

const matches = (row: Row, query: string): boolean => {
  const text = query.trim().toLowerCase();
  const digits = text.replace(/[^\d]/g, '');
  return (
    row.description.toLowerCase().includes(text) ||
    (digits !== '' && row.amount.replace(/[^\d]/g, '').includes(digits))
  );
};

const realRow = (line: StatementLineResource): Row => ({
  ...line,
  planned: false,
});
const plannedRow = (line: PlannedLineResource): Row => ({
  id: line.id,
  date: line.date,
  description: line.description,
  note: null,
  kind: line.origin,
  category_id: line.category_id,
  amount: line.amount,
  balance_after: line.balance_after,
  planned: true,
  from: line.from,
  to: line.to,
  portfolio_id: line.portfolio_id,
  tags: [],
});

const toneOf = (kind: string): string =>
  kind === 'receita' || kind === 'provento'
    ? 'text-positive'
    : kind === 'aporte'
      ? 'text-accent'
      : '';

export const AccountStatementScreen = (): React.ReactElement => {
  const { id = '' } = useParams();
  const { hidden } = usePreferences();
  const { portfolios } = usePortfolios();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<AccountStatementResource | null>(null);
  const [categories, setCategories] = useState<ReadonlyMap<string, string>>(new Map());
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [accountNames, setAccountNames] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const today = new Date().toISOString().slice(0, 10) as IsoDate;
  // O período compartilhado (o mesmo de Movimentações e da Visão geral), que já
  // escreve `de`/`ate` na URL; `mes` só chega por links e vira período.
  const { range, setRange } = useFinancePeriod();
  const wantedMonth = params.get('mes');
  useEffect(() => {
    if (wantedMonth === null || !/^\d{4}-\d{2}$/.test(wantedMonth)) return;
    setRange({ from: `${wantedMonth}-01` as IsoDate, to: endOfMonthOf(wantedMonth) });
    const search = new URLSearchParams(params);
    search.delete('mes');
    setParams(search, { replace: true });
  }, [wantedMonth, params, setParams, setRange]);
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<readonly string[]>([]);
  const [cats, setCats] = useState<readonly string[]>([]);
  const [situations, setSituations] = useState<readonly string[]>([]);

  const setPeriod = (next: { readonly from: IsoDate; readonly to: IsoDate }): void =>
    setRange(next);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    fetchAccountStatement(id, { from: range.from, to: range.to }, controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    fetchAccountNames(controller.signal)
      .then(setAccountNames)
      .catch(() => undefined);
    fetchCategories(controller.signal)
      .then((list) => setCategories(new Map(list.map((c) => [c.id, c.name]))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [id, range.from, range.to, reload]);

  const rows = useMemo<readonly Row[]>(() => {
    if (data === null) return [];
    const all = [
      ...[...data.planned].reverse().map(plannedRow),
      ...[...data.lines].reverse().map(realRow),
    ];
    return all.filter(
      (row) =>
        (query === '' || matches(row, query)) &&
        (types.length === 0 || types.includes(row.kind)) &&
        (cats.length === 0 ||
          (row.category_id !== null && cats.includes(row.category_id))) &&
        (situations.length === 0 ||
          situations.includes(row.planned ? 'previsto' : 'lancado')),
    );
  }, [data, query, types, cats, situations]);

  if (failed) {
    return (
      <PanelError
        title="Não foi possível carregar o extrato"
        onRetry={() => {
          setFailed(false);
          setReload((n) => n + 1);
        }}
      />
    );
  }
  if (data === null)
    return <TableScreenSkeleton label="Carregando extrato" columns={6} />;

  const money = (value: string): string => formatMoney(value, { hidden }).text;
  const closes = statementCloses(data);
  const whole = isWholeMonth(range);
  const portfolioName = (pid: string | null): string | null =>
    pid === null ? null : (portfolios.find((p) => p.id === pid)?.name ?? null);
  const routeOf = (row: Row): React.ReactNode => {
    const fromText = row.from ?? (row.kind === 'aporte' ? null : null);
    const toText =
      row.to === 'carteira' ? (portfolioName(row.portfolio_id) ?? row.to) : row.to;
    const fromName =
      fromText === 'carteira' ? (portfolioName(row.portfolio_id) ?? fromText) : fromText;
    if (fromName !== null && toText !== null) {
      return (
        <>
          {fromName}
          <Arrow />
          {toText}
        </>
      );
    }
    return fromName ?? toText ?? 'Ajuste';
  };
  const period = whole
    ? formatMonth(range.from).toLowerCase()
    : formatRange(range, today);
  const reachesToday = data.through === today;
  const projectedOn = `${range.to.slice(8)}/${range.to.slice(5, 7)}`;
  const entriesLink = financeRoutes.entries(
    `conta=${encodeURIComponent(data.account.id)}${
      whole ? `&mes=${range.from.slice(0, 7)}` : `&de=${range.from}&ate=${range.to}`
    }`,
  );

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title={data.account.name}
        subtitle={`${data.account.role} · extrato · ${period}`}
        period={<FlowPeriodControl value={range} onChange={setPeriod} today={today} />}
        primary={{ label: 'Movimentação', onClick: () => setCreating(true) }}
      />
      {!closes && (
        <p role="alert" className="text-sm text-negative">
          O extrato não fecha: saldo inicial + entradas − saídas difere do saldo final. Os
          valores foram ocultados até a inconsistência ser corrigida.
        </p>
      )}
      <StatStrip
        label="Resumo do extrato"
        cells={[
          {
            id: 'saldo',
            label: reachesToday ? 'Saldo de hoje' : 'Saldo no fim do período',
            value: closes ? money(data.closing) : '—',
            caption: `em ${data.through.slice(8)}/${data.through.slice(5, 7)}/${data.through.slice(0, 4)}`,
          },
          {
            id: 'entradas',
            label: whole ? 'Entradas do mês' : 'Entradas do período',
            value: (
              <span className="text-positive">{closes ? money(data.entered) : '—'}</span>
            ),
            caption: `${data.entered_count} ${data.entered_count === 1 ? 'movimentação' : 'movimentações'}`,
          },
          {
            id: 'saidas',
            label: whole ? 'Saídas do mês' : 'Saídas do período',
            value: closes ? money(data.left) : '—',
            caption: `${data.left_count} ${data.left_count === 1 ? 'movimentação' : 'movimentações'}`,
          },
          data.projected === null
            ? {
                id: 'previsto',
                label: 'Saldo de abertura',
                value: closes ? money(data.opening) : '—',
                caption: `em ${dayMonth(range.from)}`,
              }
            : {
                id: 'previsto',
                label: `Saldo previsto em ${projectedOn}`,
                value: closes ? money(data.projected) : '—',
                caption: data.projected_note,
              },
        ]}
      />
      <Panel className="overflow-visible">
        <FilterBar
          search={
            <ToolbarSearch
              value={query}
              label="Buscar no extrato"
              placeholder="Buscar no extrato"
              onChange={setQuery}
            />
          }
          fields={[
            {
              id: 'tipo',
              label: 'Tipo',
              icon: 'tag',
              options: STATEMENT_TYPES.map((t) => ({ id: t.id, label: t.label })),
              selected: types,
              onChange: setTypes,
            },
            {
              id: 'categoria',
              label: 'Categoria',
              icon: 'tag',
              options: [...categories].map(([id, label]) => ({ id, label })),
              selected: cats,
              onChange: setCats,
            },
            {
              id: 'situacao',
              label: 'Situação',
              icon: 'pulse',
              options: [
                { id: 'lancado', label: 'Lançado' },
                { id: 'previsto', label: 'Previsto' },
              ],
              selected: situations,
              onChange: setSituations,
            },
          ]}
          extraCount={query === '' ? 0 : 1}
          actions={
            <ToolbarIconButton
              label="Exportar CSV"
              icon="download"
              onClick={() =>
                downloadCsv(`extrato-${data.account.name}-${range.from}.csv`, [
                  ['Dia', 'Descrição', 'Tipo', 'Valor', 'Saldo após', 'Situação'],
                  ...rows.map((r) => [
                    r.date,
                    r.description,
                    r.kind,
                    r.amount,
                    r.balance_after,
                    r.planned ? 'previsto' : 'lancado',
                  ]),
                ])
              }
            />
          }
        />
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">Nenhum movimento neste período.</p>
        ) : (
          <FinTable caption="Extrato da conta">
            <THead>
              <Th>Dia</Th>
              <Th>Descrição</Th>
              <Th className="max-md:hidden">Tipo</Th>
              <Th className="max-lg:hidden">Origem → Destino</Th>
              <Th align="right">Valor (R$)</Th>
              <Th align="right">Saldo após (R$)</Th>
            </THead>
            <tbody>
              {rows.map((row) => {
                const kind = KIND_TO_LEDGER[row.kind] ?? null;
                const negative = row.amount.startsWith('-');
                return (
                  <tr
                    key={`${row.planned ? 'p' : 'l'}:${row.id}`}
                    className={`border-t border-line ${row.planned ? 'planned-stripes' : ''}`}
                  >
                    <td className="tabular px-3 py-[var(--row-pad)] text-ink-2">
                      {dayMonth(row.date)}
                    </td>
                    <td className="px-3 py-[var(--row-pad)] font-medium">
                      {row.description}
                      {row.tags.includes('recorrente') ? (
                        <span className="ml-1.5 rounded-[4px] bg-panel-2 px-1.5 py-0.5 text-xs font-normal text-ink-2">
                          recorrente
                        </span>
                      ) : null}
                      {row.note !== null && (
                        <span className="block text-xs font-normal text-ink-3">
                          {row.note}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-[var(--row-pad)] max-md:hidden">
                      {kind === null ? (
                        <span className="text-ink-2">Ajuste</span>
                      ) : (
                        <LedgerKindTag kind={kind} planned={row.planned} />
                      )}
                    </td>
                    <td className="px-3 py-[var(--row-pad)] text-ink-2 max-lg:hidden">
                      {routeOf(row)}
                    </td>
                    <td
                      className={`tabular px-3 py-[var(--row-pad)] text-right font-medium ${toneOf(row.kind)}`}
                    >
                      {closes ? (
                        <>
                          <span aria-hidden="true">{negative ? '−' : '+'}</span>
                          <Money value={row.amount.replace('-', '')} bare />
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="tabular px-3 py-[var(--row-pad)] text-right font-semibold">
                      {closes ? <Money value={row.balance_after} bare /> : '—'}
                      {row.planned ? (
                        <span className="ml-1.5 text-xs font-normal text-ink-3">
                          previsto
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-panel-2 font-semibold">
                <th
                  scope="row"
                  colSpan={5}
                  className="px-3 py-[var(--row-pad)] text-left"
                >
                  Saldo anterior
                </th>
                <td className="tabular px-3 py-[var(--row-pad)] text-right">
                  {closes ? <Money value={data.opening} bare /> : '—'}
                </td>
              </tr>
            </tfoot>
          </FinTable>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
          <span>
            O saldo após de cada linha é o saldo da conta logo depois dela. Linhas
            previstas não alteram o saldo de hoje.
          </span>
          <Link to={entriesLink} className="text-accent hover:underline">
            Ver no livro com este filtro
          </Link>
        </footer>
      </Panel>
      {creating && (
        <NewEntryModal
          today={data.through}
          accounts={[...accountNames].map(([aid, name]) => ({ id: aid, name }))}
          context={{ accountId: data.account.id }}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
};

/** O último dia do mês `AAAA-MM`, só calendário. */
const endOfMonthOf = (month: string): IsoDate => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}` as IsoDate;
};
