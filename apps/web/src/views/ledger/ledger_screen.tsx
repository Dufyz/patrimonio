import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { cn } from '../../lib/cn.js';

import type { BookResponse, BookRowResource } from '@patrimonio/contracts';
import type { Draft } from '../../lib/ledger_entry_form.js';

import {
  fetchAccountNames,
  fetchWholeBook,
  fetchCardNames,
  fetchCategoryOptions,
} from '../../api/book.js';
import type { CategoryOption } from '../../api/book.js';
import { skipRecurringMonth } from '../../api/recurrings.js';
import { CategoryCell } from './category_cell.js';
import { EmptyPanel, PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { downloadCsv } from '../../finance/lib/csv.js';
import { useShortcuts } from '../../components/shortcuts.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { StatStrip } from '../../finance/components/stat_strip.js';
import { FlowPeriodControl } from '../../components/period_control.js';
import { Panel } from '../../components/primitives.js';
import { Th, THead } from '../../components/table_parts.js';
import type { FilterField as BarField } from '../../components/filter_bar.js';
import {
  FilterBar,
  ToolbarIconButton,
  ToolbarSearch,
} from '../../components/filter_bar.js';
import { endOfMonth } from '../../finance/lib/dates.js';
import type { IsoDate } from '../../finance/lib/dates.js';
import { formatMonth } from '../../finance/lib/format.js';
import { formatRange, isWholeMonth } from '../../finance/lib/period.js';
import { KIND_FULL_LABEL, LedgerKindTag, PartiesCell } from './ledger_parts.js';
import type { PartyNames } from './ledger_parts.js';
import { formatMoney, MINUS } from '../../lib/format.js';
import type { Grouping, GroupSection } from '../../lib/ledger_book.js';
import {
  overdueNote,
  GROUPING_LABEL,
  GROUPINGS,
  plannedSection,
  assetTarget,
  sectionsOfGroups,
  exportRows,
  selectable,
  visibleRows,
  signOf,
  expandInvestmentLegs,
  legSign,
  postedLegsNet,
} from '../../lib/ledger_book.js';
import {
  filtersFromParams,
  filtersToParams,
  hasFilters,
  EMPTY_FILTERS,
} from '../../lib/ledger_filters.js';
import type { LedgerFilters } from '../../lib/ledger_filters.js';
import { totalLink } from '../../lib/total_links.js';
import { usePortfolios } from '../../components/portfolios_provider.js';
import { CardRowDialog } from './card_row_dialog.js';
import type { CardRowAction } from './card_row_dialog.js';
import { LaunchPlannedDialog } from './launch_planned.js';
import { BatchActions, BatchDialog } from './batch_actions.js';
import type { BatchAction } from './batch_actions.js';
import {
  canDelete,
  canMove,
  canMoveInvoice,
  isEntryRow,
  linkedOf,
  skippable,
} from '../../lib/ledger_batch.js';
import type { EditableEntry } from '../../lib/ledger_entry_form.js';
import { UNDATED_DATE } from '../../lib/ledger_entry_form.js';
import { NewEntryModal } from './new_entry_modal.js';
import { readGrouping, writeGrouping } from '../../lib/view_preferences.js';
import { useEntry } from '../../components/entry_provider.js';
import { useFinancePeriod } from '../../finance/components/period_provider.js';
import { AlertModal, Menu } from '../../components/overlay.js';
import { Icon } from '../../components/icon.js';
import { usePreferences } from '../../components/preferences.js';

/**
 * LAN-01 · Lançamentos: a faixa de cinco células e a tabela do período, por dia.
 *
 * Tudo vem do livro da `api`; a tela só rotula e agrupa. A soma da coluna Valor
 * das linhas lançadas fecha com a faixa (teste em `lib/ledger_book.test.ts`).
 */
const PLANNED_STRIPES = 'planned-stripes';

const LAUNCH_PILL =
  'cursor-pointer rounded-control bg-accent-soft px-3 py-1 text-[0.8125rem] font-medium text-accent hover:bg-planned-soft';

/** A linha de cabeçalho de uma seção: nome e etiqueta à esquerda, resumo em mono à direita. */
const SectionRow = ({
  title,
  tag,
  note,
}: {
  readonly title: string;
  readonly tag?: string | null | undefined;
  readonly note?: string | undefined;
}): React.ReactElement => (
  <tr>
    <th
      scope="rowgroup"
      colSpan={6}
      className="border-t border-line bg-panel-2 px-4 py-2.5 text-left font-normal"
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span>
          <strong className="font-semibold text-ink">{title}</strong>
          {tag === undefined || tag === null ? null : (
            <span className="ml-1.5 text-[0.8125rem] text-ink-3">· {tag}</span>
          )}
        </span>
        {note === undefined ? null : (
          <span className="tabular text-xs text-ink-3">{note}</span>
        )}
      </span>
    </th>
  </tr>
);

const KIND_LABEL = KIND_FULL_LABEL;

/** O nome de cada seção no agrupamento por tipo, como na prancha 2.2. */
const SECTION_LABEL: Readonly<Record<string, string>> = {
  APORTE: 'Aportes · despesa financeira',
  DESPESA: 'Despesas',
  RECEITA: 'Receitas',
  PROVENTO: 'Proventos',
  RESGATE: 'Resgates',
  TRANSFERENCIA: 'Transferências',
  PAGAMENTO_FATURA: 'Pagamentos de fatura',
  EVENTO: 'Eventos',
};

/** Aporte, resgate, provento e evento: transações de posição, editadas no formulário de investimento. */
const isInvestmentRow = (row: BookRowResource): boolean =>
  row.kind === 'APORTE' ||
  row.kind === 'RESGATE' ||
  row.kind === 'PROVENTO' ||
  row.kind === 'EVENTO';

/** O sufixo que a lista acrescenta à perna da conta (" · saída da conta"). */
const LEG_SUFFIX = / · (saída da conta|entrada na conta)$/;

const isZeroText = (value: string): boolean => /^-?0+(\.0+)?$/.test(value);

const PLANNED_APORTE = 'previsto-aporte:';

/** LAN-06 · O que o modal de aporte recebe de uma linha prevista: carteira, ativo, conta e valor. */
export const aportePrefill = (row: BookRowResource, today: string): Partial<Draft> => {
  const recurringId = row.id.startsWith(PLANNED_APORTE)
    ? (row.id.slice(PLANNED_APORTE.length).split(':')[0] ?? '')
    : '';
  return {
    kind: 'APORTE',
    portfolioId: row.portfolio_id ?? '',
    accountId: row.account_id ?? '',
    asset:
      row.asset_id === null
        ? null
        : { id: row.asset_id, label: row.description, name: null, held: null },
    quantity: '1',
    unitPrice: row.amount ?? '',
    date: row.date < today ? row.date : today,
    recurringId,
  };
};

export const LedgerScreen = (): React.ReactElement => {
  const { hidden } = usePreferences();
  const [params, setParams] = useSearchParams();
  // O período é o compartilhado (o mesmo da Visão geral), que também escreve
  // `de`/`ate` na URL; `mes` só chega por links ("abrir lista") e vira período.
  const { range, setRange } = useFinancePeriod();
  const wantedMonth = params.get('mes');
  useEffect(() => {
    if (wantedMonth === null || !/^\d{4}-\d{2}$/.test(wantedMonth)) return;
    setRange({
      from: `${wantedMonth}-01` as IsoDate,
      to: endOfMonth(`${wantedMonth}-01` as IsoDate),
    });
    const search = new URLSearchParams(params);
    search.delete('mes');
    setParams(search, { replace: true });
  }, [wantedMonth, params, setParams, setRange]);
  const month = range.from.slice(0, 7);
  const customRange = isWholeMonth(range) ? null : range;
  const filters = filtersFromParams(params);
  const filterKey = params.toString();
  const setFilters = (next: LedgerFilters): void =>
    setParams(filtersToParams(next, params), { replace: true });
  const setPeriod = (next: { readonly from: IsoDate; readonly to: IsoDate }): void =>
    setRange(next);
  const [grouping, setGrouping] = useState<Grouping>(() => {
    const wanted = params.get('agrupar');
    return (GROUPINGS as readonly string[]).includes(wanted ?? '')
      ? (wanted as Grouping)
      : readGrouping('lancamentos', GROUPINGS, 'dia');
  });
  const [book, setBook] = useState<BookResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [accounts, setAccounts] = useState<ReadonlyMap<string, string>>(new Map());
  const [cards, setCards] = useState<ReadonlyMap<string, string>>(new Map());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [launchingAporte, setLaunchingAporte] = useState<BookRowResource | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const shortcuts = useMemo(() => ({ filter: () => setFilterOpen((open) => !open) }), []);
  useShortcuts(shortcuts);
  const [launching, setLaunching] = useState<BookRowResource | null>(null);
  const [skipping, setSkipping] = useState<BookRowResource | null>(null);
  const skip = async (row: BookRowResource): Promise<void> => {
    const target = skippable(row);
    if (target === null) return;
    try {
      await skipRecurringMonth(
        target.recurringId,
        target.month,
        globalThis.crypto.randomUUID(),
      );
    } finally {
      setReload((n) => n + 1);
    }
  };
  const [cardAction, setCardAction] = useState<{
    readonly row: BookRowResource;
    readonly action: CardRowAction;
  } | null>(null);
  const [editRow, setEditRow] = useState<BookRowResource | null>(null);
  const [single, setSingle] = useState<{
    readonly row: BookRowResource;
    readonly action: BatchAction;
  } | null>(null);
  const openSingle = (row: BookRowResource, action: BatchAction): void => {
    setSingle({ row, action });
  };
  const [reload, setReload] = useState(0);
  // Transações de posição (aporte, resgate, provento) gravadas pelo modal de
  // Posições também recarregam o livro.
  const entry = useEntry();
  const entryVersion = entry.version;
  const { portfolios: portfolioList, slugs } = usePortfolios();
  const [categories, setCategories] = useState<readonly CategoryOption[]>([]);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    fetchCategoryOptions()
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetchAccountNames()
      .then(setAccounts)
      .catch(() => undefined);
    fetchCardNames()
      .then(setCards)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchWholeBook(
      {
        ...(customRange === null
          ? { month }
          : { from: customRange.from, to: customRange.to }),
        groupBy: grouping,
        ...filtersFromParams(new URLSearchParams(filterKey)),
      },
      controller.signal,
    )
      .then(setBook)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [
    month,
    customRange?.from,
    customRange?.to,
    reload,
    filterKey,
    grouping,
    entryVersion,
  ]);

  // Os previstos não dependem do período: a seção do topo mostra tudo o que
  // está previsto daqui para a frente (e o que venceu no último ano sem lançar),
  // com os mesmos filtros da lista.
  const [allPlanned, setAllPlanned] = useState<readonly BookRowResource[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const now = new Date();
    const back = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const ahead = new Date(now.getFullYear() + 2, now.getMonth() + 1, 0);
    const iso = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const filters = filtersFromParams(new URLSearchParams(filterKey));
    fetchWholeBook(
      { ...filters, from: iso(back), to: iso(ahead), situacao: ['previsto'] },
      controller.signal,
    )
      .then((planned) => setAllPlanned(planned.rows))
      .catch(() => {
        if (!controller.signal.aborted) setAllPlanned(null);
      });
    return () => controller.abort();
  }, [reload, filterKey, entryVersion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (failed) {
    return (
      <PanelError
        title="Não foi possível carregar as movimentações"
        onRetry={() => {
          setFailed(false);
          setReload((n) => n + 1);
        }}
      />
    );
  }
  if (book === null) {
    return <TableScreenSkeleton label="Carregando movimentações" stats={5} columns={6} />;
  }

  const { totals } = book;
  const rows = visibleRows(book.rows, filters.tipo);
  const chosen = rows.filter((r) => selected.has(r.id));
  const visibleSelectable = rows.filter(selectable);
  const toggle = (id: string): void =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const planned = plannedSection(
    grouping === 'dia' &&
      (filters.situacao.length === 0 || filters.situacao.includes('previsto'))
      ? visibleRows(allPlanned ?? book.rows, filters.tipo)
      : [],
    today,
  );
  // Previstos sem data: não têm período, então aparecem em qualquer recorte.
  const undated = book.undated ?? [];
  const sections: readonly GroupSection[] =
    book.groups === null
      ? []
      : sectionsOfGroups(
          book.groups,
          grouping,
          (k) => SECTION_LABEL[k] ?? k,
          filters.tipo,
        );
  const names: PartyNames = {
    account: (id) => accounts.get(id) ?? null,
    card: (id) => cards.get(id) ?? null,
    portfolio: (id) => portfolioList.find((p) => p.id === id)?.name ?? null,
    source: (id) => accounts.get(id) ?? cards.get(id) ?? null,
    out: (value) => `${MINUS}${formatMoney(value, { hidden, bare: true }).text}`,
  };
  const signed = (value: string): string =>
    formatMoney(value, { hidden, signed: true }).text;
  const plain = (value: string): string => formatMoney(value, { hidden }).text;
  const bare = (value: string): string => formatMoney(value, { hidden, bare: true }).text;
  const subtitle = `Livro único · ${
    isWholeMonth(range) ? formatMonth(range.from) : formatRange(range, today as IsoDate)
  } · agrupado por ${GROUPING_LABEL[grouping].toLowerCase()}`;
  const postedCount = rows.filter((r) => r.situation === 'lancado').length;

  const sectionNote = (section: GroupSection): string => {
    if (grouping === 'dia') {
      const net = postedLegsNet(section.rows);
      const eff = isZeroText(net) ? '' : ` · ${signed(net)}`;
      return `${section.count} ${section.count === 1 ? 'movimentação' : 'movimentações'}${eff}`;
    }
    if (grouping === 'conta_carteira') {
      return section.flow === null
        ? `${section.count}`
        : `entradas ${bare(section.flow.entradas)} · saídas ${bare(section.flow.saidas)}`;
    }
    const kind = section.key as BookRowResource['kind'];
    const sign = kind === 'APORTE' ? '+' : kind === 'RESGATE' ? '-' : signOf(kind);
    const money = (value: string): string =>
      isZeroText(value) || sign === ''
        ? plain(value)
        : sign === '-'
          ? signed(`-${value}`)
          : signed(value);
    const parts = [`${section.count}`, `lançado ${money(section.sums.lancado)}`];
    if (section.rows.some((r) => r.situation === 'previsto')) {
      parts.push(`previsto ${money(section.sums.previsto)}`);
    }
    return parts.join(' · ');
  };

  const renderRow = (row: BookRowResource, isPlanned: boolean): React.ReactElement => {
    const note = isPlanned ? overdueNote(row.date, today) : null;
    const target = assetTarget(row, filters.carteira, slugs);
    const paymentCount =
      row.kind === 'DESPESA'
        ? ((row.entry as { payments?: readonly unknown[] } | null)?.payments?.length ?? 0)
        : 0;
    const userNote =
      (row.entry as { readonly note?: string | null } | null)?.note?.trim() ?? '';
    const sign = legSign(row);
    // Aporte e resgate: a perna do ativo em azul; a da conta segue o sinal.
    const tone =
      (row.kind === 'APORTE' || row.kind === 'RESGATE') && row.side != null
        ? row.side === 'entrada' && row.kind === 'RESGATE'
          ? 'text-positive'
          : row.side === 'entrada'
            ? 'text-accent'
            : ''
        : row.kind === 'APORTE'
          ? 'text-accent'
          : row.kind === 'RECEITA' || row.kind === 'PROVENTO'
            ? 'text-positive'
            : '';
    const amount =
      row.amount === null
        ? '—'
        : `${sign === '-' ? MINUS : sign === '+' ? '+' : ''}${bare(row.amount)}`;
    return (
      <tr
        key={`${row.id}:${row.side ?? ''}:${isPlanned ? 'p' : 'l'}`}
        data-situation={row.situation}
        tabIndex={isPlanned ? undefined : 0}
        className={cn(
          'group border-t border-line hover:bg-panel-2',
          isPlanned && PLANNED_STRIPES,
        )}
        onKeyDown={
          isPlanned
            ? undefined
            : (e) => {
                const rowEl = e.currentTarget;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  (rowEl.nextElementSibling as HTMLElement | null)?.focus();
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  (rowEl.previousElementSibling as HTMLElement | null)?.focus();
                } else if (e.key === ' ' && e.target === rowEl && selectable(row)) {
                  e.preventDefault();
                  toggle(row.id);
                }
              }
        }
      >
        <td className="px-3 py-[var(--row-pad)] font-medium">
          <span className="inline-flex items-center gap-3">
            {selectable(row) ? (
              <input
                type="checkbox"
                aria-label={`Selecionar ${row.description}`}
                className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 checked:opacity-100"
                checked={selected.has(row.id)}
                onChange={() => toggle(row.id)}
              />
            ) : (
              <span aria-hidden="true" className="inline-block w-[13px]" />
            )}
            {isPlanned && row.date !== UNDATED_DATE ? (
              <span className="tabular w-10 shrink-0 font-normal text-ink-3">
                {`${row.date.slice(8, 10)}/${row.date.slice(5, 7)}`}
              </span>
            ) : null}
            {target === null ? (
              row.description
            ) : (
              <Link to={target} className="cursor-pointer hover:underline">
                {row.description}
              </Link>
            )}
            {paymentCount > 1 ? (
              <span className="font-normal text-ink-3">· {paymentCount} origens</span>
            ) : null}
            {note === null ? null : (
              <span className="font-normal text-attention">{note}</span>
            )}
            {userNote === '' ? null : (
              <span title={userNote} className="max-w-56 truncate font-normal text-ink-3">
                · {userNote}
              </span>
            )}
          </span>
        </td>
        <td className="px-3 py-[var(--row-pad)] max-md:hidden">
          <LedgerKindTag kind={row.kind} planned={isPlanned} />
        </td>
        <td className="px-3 py-[var(--row-pad)] text-ink-2 max-lg:hidden">
          <CategoryCell
            row={row}
            categories={categories}
            onSaved={() => setReload((n) => n + 1)}
          />
        </td>
        <td className="px-3 py-[var(--row-pad)] max-xl:hidden">
          <PartiesCell row={row} names={names} />
        </td>
        <td
          className={cn(
            'tabular px-3 py-[var(--row-pad)] text-right font-semibold',
            tone,
          )}
        >
          {amount}
        </td>
        {isPlanned ? (
          <td data-launch className="px-3 py-[var(--row-pad)] text-right">
            {row.entry === null ? (
              row.kind === 'APORTE' ? (
                <button
                  type="button"
                  className={LAUNCH_PILL}
                  onClick={() => setLaunchingAporte(row)}
                >
                  Lançar
                </button>
              ) : null
            ) : // Previsto se edita; a data decide: hoje ou antes, ele fica lançado.
            isEntryRow(row) ? (
              <button
                type="button"
                aria-label={`Editar ${row.description}`}
                className={LAUNCH_PILL}
                onClick={() => setEditRow(row)}
              >
                Editar
              </button>
            ) : (
              <button
                type="button"
                className={LAUNCH_PILL}
                onClick={() => setLaunching(row)}
              >
                Lançar
              </button>
            )}
            {skippable(row) === null && !(isEntryRow(row) && canDelete(row)) ? null : (
              <span className="ml-1.5 inline-block align-middle">
                <Menu
                  label={`Ações de ${row.description}`}
                  items={
                    skippable(row) === null
                      ? [
                          {
                            id: 'delete',
                            label: 'Excluir',
                            icon: <Icon name="trash" />,
                            destructive: true,
                            onSelect: () => openSingle(row, 'delete'),
                          },
                        ]
                      : [
                          {
                            id: 'skip',
                            label: 'Pular este mês',
                            hint: 'o recorrente continua nos próximos meses',
                            icon: <Icon name="repeat" />,
                            onSelect: () => setSkipping(row),
                          },
                        ]
                  }
                />
              </span>
            )}
          </td>
        ) : (
          <td className="px-3 py-[var(--row-pad)] text-right">
            <Menu
              label={`Ações de ${row.description}`}
              items={[
                {
                  id: 'edit',
                  label: 'Editar',
                  icon: <Icon name="pencil" />,
                  disabled: !isEntryRow(row) && !isInvestmentRow(row),
                  hint:
                    isEntryRow(row) || isInvestmentRow(row)
                      ? undefined
                      : 'corrige-se excluindo e lançando de novo',
                  onSelect: () => {
                    if (isInvestmentRow(row)) {
                      entry.openEdit(row.id, row.description.replace(LEG_SUFFIX, ''));
                    } else setEditRow(row);
                  },
                },
                ...(canMoveInvoice(row)
                  ? [
                      {
                        id: 'move_invoice',
                        label: 'Mover de fatura',
                        icon: <Icon name="card" />,
                        onSelect: () => setCardAction({ row, action: 'move_invoice' }),
                      },
                      {
                        id: 'reverse',
                        label: 'Estornar',
                        icon: <Icon name="undo" />,
                        onSelect: () => setCardAction({ row, action: 'reverse' }),
                      },
                    ]
                  : []),
                {
                  id: 'move',
                  label: 'Mover de conta',
                  icon: <Icon name="swap" />,
                  disabled: !canMove(row),
                  hint: canMove(row) ? undefined : 'só despesa ou receita paga em conta',
                  onSelect: () => openSingle(row, 'move'),
                },
                {
                  id: 'delete',
                  label: 'Excluir',
                  icon: <Icon name="trash" />,
                  destructive: true,
                  disabled: !canDelete(row),
                  hint: canDelete(row)
                    ? undefined
                    : 'pagamento de fatura sai pela fatura',
                  onSelect: () => openSingle(row, 'delete'),
                },
              ]}
            />
          </td>
        )}
      </tr>
    );
  };

  const filterFields: readonly BarField[] = [
    {
      id: 'tipo',
      label: 'Tipo',
      icon: 'tag',
      options: Object.entries(KIND_LABEL).map(([id, label]) => ({ id, label })),
      selected: filters.tipo,
      onChange: (tipo) => setFilters({ ...filters, tipo: [...tipo] }),
    },
    {
      id: 'categoria',
      label: 'Categoria',
      icon: 'tag',
      options: categories.map((c) => ({ id: c.id, label: c.name })),
      selected: filters.categoria,
      onChange: (categoria) => setFilters({ ...filters, categoria: [...categoria] }),
    },
    {
      id: 'conta',
      label: 'Conta',
      icon: 'bank',
      options: [...accounts].map(([id, label]) => ({ id, label })),
      selected: filters.conta,
      onChange: (conta) => setFilters({ ...filters, conta: [...conta] }),
    },
    {
      id: 'carteira',
      label: 'Carteira',
      icon: 'briefcase',
      options: portfolioList.map((p) => ({ id: p.id, label: p.name })),
      selected: filters.carteira,
      onChange: (carteira) => setFilters({ ...filters, carteira: [...carteira] }),
    },
    {
      id: 'situacao',
      label: 'Situação',
      icon: 'pulse',
      options: [
        { id: 'lancado', label: 'Lançado' },
        { id: 'previsto', label: 'Previsto' },
      ],
      selected: filters.situacao,
      onChange: (situacao) => setFilters({ ...filters, situacao: [...situacao] }),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Movimentações"
        subtitle={subtitle}
        period={
          <FlowPeriodControl
            value={range}
            onChange={setPeriod}
            today={today as IsoDate}
          />
        }
        primary={{
          label: 'Movimentação',
          onClick: () => setCreating(true),
          pending: planned.rows.filter((r) => r.date <= today).length,
        }}
      />
      {creating ? (
        <NewEntryModal
          today={today}
          accounts={[...accounts].map(([id, name]) => ({ id, name }))}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {launchingAporte === null ? null : (
        <NewEntryModal
          today={today}
          accounts={[...accounts].map(([id, name]) => ({ id, name }))}
          initialKind="APORTE"
          prefill={aportePrefill(launchingAporte, today)}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setLaunchingAporte(null)}
        />
      )}
      {editRow === null || editRow.entry === null ? null : (
        <NewEntryModal
          today={today}
          accounts={[...accounts].map(([id, name]) => ({ id, name }))}
          editing={{ id: editRow.id, entry: editRow.entry as unknown as EditableEntry }}
          onSaved={() => setReload((n) => n + 1)}
          onClose={() => setEditRow(null)}
        />
      )}
      <StatStrip
        label="Resumo do período"
        cells={[
          {
            id: 'receitas',
            label: 'Receitas',
            value: plain(totals.receitas),
            to: totalLink({ kind: 'receitas', month }),
            caption: isZeroText(totals.previsto.receitas)
              ? undefined
              : `+ ${plain(totals.previsto.receitas)} previstos`,
          },
          {
            id: 'despesas',
            label: 'Despesas',
            value: plain(totals.despesas),
            to: totalLink({ kind: 'despesas', month }),
            caption: 'consumo, sem aportes',
          },
          {
            id: 'aportes',
            label: 'Aportes',
            value: plain(totals.aportes),
            to: totalLink({ kind: 'aportes', month }),
            caption: isZeroText(totals.previsto.aportes)
              ? 'despesa financeira'
              : `despesa financeira · + ${plain(totals.previsto.aportes)} previsto`,
          },
          {
            id: 'saldo',
            label: 'Saldo do mês',
            value: (
              <span
                className={
                  totals.saldo_do_mes.startsWith('-') ? 'text-negative' : 'text-positive'
                }
              >
                {signed(totals.saldo_do_mes)}
              </span>
            ),
            caption: `sai da conta: ${plain(totals.sai_da_conta)}`,
          },
          {
            id: 'a-lancar',
            label: 'Ainda a lançar',
            value: `${totals.a_lancar} ${totals.a_lancar === 1 ? 'previsto' : 'previstos'}`,
            to: totalLink({ kind: 'a_lancar', month }),
            caption: `efeito líquido ${signed(totals.a_lancar_efeito)}`,
          },
        ]}
      />
      <Panel className="overflow-visible">
        <FilterBar
          open={filterOpen}
          onOpenChange={setFilterOpen}
          search={
            <ToolbarSearch
              value={filters.q}
              label="Buscar movimentação"
              placeholder="Buscar movimentação"
              onChange={(q) => setFilters({ ...filters, q })}
            />
          }
          fields={filterFields}
          extraCount={filters.q === '' ? 0 : 1}
          display={{
            groupBy: {
              label: 'Agrupar por',
              value: grouping,
              options: GROUPINGS.map((g) => ({ value: g, label: GROUPING_LABEL[g] })),
              onChange: (value) => {
                const next = value as Grouping;
                writeGrouping('lancamentos', next);
                setGrouping(next);
              },
            },
          }}
          actions={
            <ToolbarIconButton
              label="Exportar CSV"
              icon="download"
              onClick={() =>
                downloadCsv(
                  `lancamentos-${month}.csv`,
                  exportRows(rows, (k) => KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k),
                )
              }
            />
          }
        />
        {chosen.length > 0 ? (
          <BatchActions
            chosen={chosen}
            accounts={accounts}
            hidden={hidden}
            onDone={() => setReload((n) => n + 1)}
            onClear={() => setSelected(new Set())}
          />
        ) : null}
        {rows.length === 0 && undated.length === 0 ? (
          hasFilters(filters) ? (
            <EmptyPanel
              message="Nenhuma movimentação encontrada com esses filtros."
              actionLabel="Limpar filtros"
              onAction={() => setFilters(EMPTY_FILTERS)}
            />
          ) : (
            <EmptyPanel
              message="Nenhuma movimentação no período"
              actionLabel="Nova movimentação"
              onAction={() => setCreating(true)}
            />
          )
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-cell whitespace-nowrap">
            <caption className="sr-only">Movimentações do período</caption>
            <THead>
              <Th>
                <input
                  type="checkbox"
                  aria-label="Selecionar todos os visíveis"
                  className="mr-3 align-middle"
                  checked={
                    visibleSelectable.length > 0 &&
                    chosen.length === visibleSelectable.length
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(visibleSelectable.map((r) => r.id))
                        : new Set(),
                    )
                  }
                />
                Descrição
              </Th>
              <Th className="max-md:hidden">Tipo</Th>
              <Th className="max-lg:hidden">Categoria</Th>
              <Th className="max-xl:hidden">Conta / Carteira</Th>
              <Th align="right">Valor (R$)</Th>
              <Th align="right">
                <span className="sr-only">Ações</span>
              </Th>
            </THead>
            {undated.length === 0 ? null : (
              <tbody data-section="sem-data">
                <SectionRow
                  title="Previstos sem data"
                  note={`${undated.length} ${undated.length === 1 ? 'previsto' : 'previstos'} · fora do período e dos totais`}
                />
                {undated.map((row) => renderRow(row, true))}
              </tbody>
            )}
            {planned.rows.length === 0 ? null : (
              <tbody data-section="previstos">
                <SectionRow
                  title="Previstos · a lançar"
                  note={`${planned.counter} · efeito líquido ${signed(totals.a_lancar_efeito)}`}
                />
                {expandInvestmentLegs(planned.rows).map((row) => renderRow(row, true))}
              </tbody>
            )}
            {sections.map((section) => {
              return (
                <tbody key={section.key}>
                  <SectionRow
                    title={section.label}
                    tag={section.tag}
                    note={sectionNote(section)}
                  />
                  {(grouping === 'conta_carteira'
                    ? section.rows
                    : expandInvestmentLegs(section.rows)
                  ).map((row) => renderRow(row, row.situation === 'previsto'))}
                </tbody>
              );
            })}
          </table>
        </div>
        {rows.length === 0 ? null : grouping === 'dia' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
            <span>
              {postedCount} lançados · {planned.rows.length} previstos ·{' '}
              {formatRange(range, today as IsoDate)}
            </span>
          </div>
        ) : grouping === 'conta_carteira' ? (
          <p className="border-t border-line px-4 py-3 text-[0.8125rem] text-ink-3">
            O aporte aparece nas duas pontas: saída na conta e entrada na carteira. O
            total geral não soma os dois lados.
          </p>
        ) : null}
      </Panel>
      <AlertModal
        icon="repeat"
        open={skipping !== null}
        danger={false}
        title={`Pular "${skipping?.description ?? ''}" neste mês?`}
        message="O previsto deste mês sai da lista e do saldo previsto. O recorrente continua: no mês que vem ele volta normalmente."
        cancelLabel="Cancelar"
        confirmLabel="Pular este mês"
        onCancel={() => setSkipping(null)}
        onConfirm={() => {
          const target = skipping;
          setSkipping(null);
          if (target !== null) void skip(target);
        }}
      />
      <LaunchPlannedDialog
        planned={
          launching === null
            ? null
            : {
                id: launching.id,
                description: launching.description,
                date: launching.date,
                cents: launching.amount,
              }
        }
        today={today}
        onClose={() => setLaunching(null)}
        onDone={() => setReload((n) => n + 1)}
      />
      <CardRowDialog
        row={cardAction?.row ?? null}
        action={cardAction?.action ?? null}
        hidden={hidden}
        onClose={() => setCardAction(null)}
        onDone={() => setReload((n) => n + 1)}
      />
      <BatchDialog
        action={single?.action ?? null}
        chosen={single === null ? [] : [single.row]}
        linked={single === null ? null : linkedOf(single.row, book.rows)}
        accounts={accounts}
        hidden={hidden}
        onClose={() => setSingle(null)}
        onDone={() => setReload((n) => n + 1)}
      />
    </div>
  );
};
