import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import type { BookResponse, BookRowResource } from '@patrimonio/contracts';

import { confirmPlanned, fetchAccountNames, fetchBook } from '../../api/book.js';
import { EmptyPanel, PanelError } from '../../finance/components/states.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { downloadCsv } from '../../finance/lib/csv.js';
import { useShortcuts } from '../../components/shortcuts.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { StatStrip } from '../../finance/components/stat_strip.js';
import { formatMoney, formatQuantity, MINUS } from '../../lib/format.js';
import type { Grouping, GroupSection } from '../../lib/ledger_book.js';
import {
  dayLabel,
  overdueNote,
  GROUPING_LABEL,
  GROUPINGS,
  plannedSection,
  sectionsOfGroups,
  detailOf,
  exportRows,
  selectable,
  sectionsByDay,
  visibleRows,
  signOf,
} from '../../lib/ledger_book.js';
import {
  chipsOf,
  filtersFromParams,
  filtersToParams,
  hasFilters,
  removeChip,
  EMPTY_FILTERS,
} from '../../lib/ledger_filters.js';
import type { LedgerFilters } from '../../lib/ledger_filters.js';
import { totalLink } from '../../lib/total_links.js';
import { BatchActions, BatchDialog } from './batch_actions.js';
import type { BatchAction } from './batch_actions.js';
import { canDelete, canMove } from '../../lib/ledger_batch.js';
import { NewEntryModal } from './new_entry_modal.js';
import { readGrouping, writeGrouping } from '../../lib/view_preferences.js';
import { usePreferences } from '../../components/preferences.js';

/**
 * LAN-01 · Lançamentos: a faixa de cinco células e a tabela do período, por dia.
 *
 * Tudo vem do livro da `api`; a tela só rotula e agrupa. A soma da coluna Valor
 * das linhas lançadas fecha com a faixa (teste em `lib/ledger_book.test.ts`).
 */
const KIND_LABEL: Readonly<Record<BookRowResource['kind'], string>> = {
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
  TRANSFERENCIA: 'Transferência',
  PAGAMENTO_FATURA: 'Pagamento de fatura',
  APORTE: 'Aporte',
  RESGATE: 'Resgate',
  PROVENTO: 'Provento',
  EVENTO: 'Evento',
};

const SITUATION_LABEL: Readonly<Record<string, string>> = {
  lancado: 'Lançado',
  previsto: 'Previsto',
};

const FilterGroup = ({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly (readonly [string, string])[];
  readonly value: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}): React.ReactElement => (
  <details className="relative">
    <summary className="cursor-pointer rounded-field border border-line px-3 py-1.5">
      {label}
      {value.length === 0 ? '' : ` (${value.length})`}
    </summary>
    <fieldset className="absolute z-10 mt-1 rounded-field border border-line bg-panel p-2">
      <legend className="sr-only">{label}</legend>
      {options.map(([id, text]) => (
        <label key={id} className="flex items-center gap-2 whitespace-nowrap">
          <input
            type="checkbox"
            checked={value.includes(id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, id] : value.filter((v) => v !== id))
            }
          />
          {text}
        </label>
      ))}
    </fieldset>
  </details>
);

const currentMonth = (): string => new Date().toISOString().slice(0, 7);

export const LedgerScreen = (): React.ReactElement => {
  const { hidden } = usePreferences();
  const [params, setParams] = useSearchParams();
  const wantedMonth = params.get('mes');
  const month =
    wantedMonth !== null && /^\d{4}-\d{2}$/.test(wantedMonth)
      ? wantedMonth
      : currentMonth();
  const filters = filtersFromParams(params);
  const filterKey = params.toString();
  const setFilters = (next: LedgerFilters): void =>
    setParams(filtersToParams(next, params), { replace: true });
  const [grouping, setGrouping] = useState<Grouping>(() => {
    const wanted = params.get('agrupar');
    return (GROUPINGS as readonly string[]).includes(wanted ?? '')
      ? (wanted as Grouping)
      : readGrouping('lancamentos', GROUPINGS, 'dia');
  });
  const [book, setBook] = useState<BookResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [accounts, setAccounts] = useState<ReadonlyMap<string, string>>(new Map());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const shortcuts = useMemo(() => ({ filter: () => searchBox.current?.focus() }), []);
  useShortcuts(shortcuts);
  const [menuRow, setMenuRow] = useState<string | null>(null);
  const [single, setSingle] = useState<{
    readonly row: BookRowResource;
    readonly action: BatchAction;
  } | null>(null);
  const openSingle = (row: BookRowResource, action: BatchAction): void => {
    setMenuRow(null);
    setSingle({ row, action });
  };
  const [reload, setReload] = useState(0);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    fetchAccountNames()
      .then(setAccounts)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchBook(
      {
        month,
        limit: 200,
        ...(grouping === 'dia' ? {} : { groupBy: grouping }),
        ...filtersFromParams(new URLSearchParams(filterKey)),
      },
      controller.signal,
    )
      .then(setBook)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [month, reload, filterKey, grouping]);

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
        title="Não foi possível carregar os lançamentos"
        onRetry={() => {
          setFailed(false);
          setReload((n) => n + 1);
        }}
      />
    );
  }
  if (book === null) {
    return <TableScreenSkeleton label="Carregando lançamentos" stats={5} columns={6} />;
  }

  const money = (value: string, sign: '+' | '-' | ''): string => {
    const text = formatMoney(value, { hidden }).text;
    return sign === '-' ? `${MINUS}${text}` : sign === '+' ? `+${text}` : text;
  };
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
  const planned = plannedSection(grouping === 'dia' ? rows : [], today);
  const sections: readonly GroupSection[] =
    grouping === 'dia' || book.groups === null
      ? sectionsByDay(rows.filter((r) => r.situation === 'lancado')).map((d) => ({
          key: d.date,
          label: dayLabel(d.date),
          count: d.rows.length,
          rows: d.rows,
        }))
      : sectionsOfGroups(
          book.groups,
          grouping,
          (k) => KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k,
          filters.tipo,
        );
  const detail = (row: BookRowResource): string | null =>
    detailOf(row, {
      money: (v) => formatMoney(v, { hidden }).text,
      quantity: (v) => formatQuantity(v).text,
      accountName: (id) => accounts.get(id) ?? null,
    });

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Lançamentos"
        subtitle={`${book.count} ${book.count === 1 ? 'lançamento' : 'lançamentos'} no período`}
        primary={{
          label: 'Lançamento',
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
      <StatStrip
        label="Resumo do período"
        cells={[
          {
            id: 'receitas',
            label: 'Receitas',
            value: money(totals.receitas, '+'),
            to: totalLink({ kind: 'receitas', month }),
          },
          {
            id: 'despesas',
            label: 'Despesas',
            value: money(totals.despesas, '-'),
            to: totalLink({ kind: 'despesas', month }),
          },
          {
            id: 'aportes',
            label: 'Aportes',
            value: money(totals.aportes, '-'),
            to: totalLink({ kind: 'aportes', month }),
          },
          {
            id: 'saldo',
            label: 'Saldo do mês',
            value: formatMoney(totals.saldo_do_mes, { hidden, signed: true }).text,
          },
          {
            id: 'a-lancar',
            label: 'A lançar',
            value: String(totals.a_lancar),
            to: totalLink({ kind: 'a_lancar', month }),
            caption: `${totals.a_lancar} previstos até ${book.range.to.slice(8)}/${book.range.to.slice(5, 7)}`,
          },
        ]}
      />
      <div role="search" className="flex flex-wrap items-center gap-2">
        <input
          ref={searchBox}
          type="search"
          aria-label="Buscar lançamento"
          placeholder="Buscar lançamento"
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          className="rounded-field border border-line bg-field px-3 py-1.5"
        />
        <FilterGroup
          label="Tipo"
          options={Object.entries(KIND_LABEL)}
          value={filters.tipo}
          onChange={(tipo) => setFilters({ ...filters, tipo })}
        />
        <FilterGroup
          label="Situação"
          options={[
            ['lancado', 'Lançado'],
            ['previsto', 'Previsto'],
          ]}
          value={filters.situacao}
          onChange={(situacao) => setFilters({ ...filters, situacao })}
        />
        <label className="ml-auto flex items-center gap-2 text-sm">
          Agrupar:
          <select
            value={grouping}
            onChange={(e) => {
              const next = e.target.value as Grouping;
              writeGrouping('lancamentos', next);
              setGrouping(next);
            }}
            className="rounded-field border border-line bg-field px-2 py-1.5"
          >
            {GROUPINGS.map((g) => (
              <option key={g} value={g}>
                {GROUPING_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label="Exportar CSV"
          onClick={() =>
            downloadCsv(
              `lancamentos-${month}.csv`,
              exportRows(rows, (k) => KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k),
            )
          }
          className="cursor-pointer rounded-field border border-line px-3 py-1.5"
        >
          Exportar
        </button>
      </div>
      {chosen.length > 0 ? (
        <BatchActions
          chosen={chosen}
          accounts={accounts}
          hidden={hidden}
          onDone={() => setReload((n) => n + 1)}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      {hasFilters(filters) ? (
        <ul aria-label="Filtros ativos" className="flex flex-wrap gap-2">
          {chipsOf(
            filters,
            (_key, value) =>
              KIND_LABEL[value as keyof typeof KIND_LABEL] ??
              SITUATION_LABEL[value] ??
              value,
          ).map((chip) => (
            <li key={`${chip.key}:${chip.value}`}>
              <button
                type="button"
                aria-label={`Remover filtro ${chip.label}`}
                onClick={() => setFilters(removeChip(filters, chip))}
                className="cursor-pointer rounded-full border border-line px-2 py-0.5 text-xs"
              >
                {chip.label} ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length === 0 ? (
        hasFilters(filters) ? (
          <EmptyPanel
            message="Nenhum lançamento encontrado com esses filtros."
            actionLabel="Limpar filtros"
            onAction={() => setFilters(EMPTY_FILTERS)}
          />
        ) : (
          <EmptyPanel
            message="Nenhum lançamento no período"
            actionLabel="Novo lançamento"
            onAction={() => setCreating(true)}
          />
        )
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-label text-ink-3 uppercase">
            <th scope="col">
              <input
                type="checkbox"
                aria-label="Selecionar todos os visíveis"
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
            </th>
            <th scope="col">Data</th>
            <th scope="col">Descrição</th>
            <th scope="col" className="max-md:hidden">
              Tipo
            </th>
            <th scope="col" className="max-xl:hidden">
              Detalhe
            </th>
            <th scope="col" className="text-right">
              Valor
            </th>
            <td />
          </tr>
        </thead>
        {planned.rows.length === 0 ? null : (
          <tbody data-section="previstos">
            <tr>
              <th scope="rowgroup" colSpan={7} className="pt-3 text-left text-ink-2">
                Próximos dias · previstos{' '}
                <span className="font-normal text-ink-3">
                  {planned.counter} · não entram nos totais do mês
                </span>
              </th>
            </tr>
            {planned.rows.map((row) => {
              const note = overdueNote(row.date, today);
              return (
                <tr key={row.id} data-situation="previsto" className="bg-planned-soft">
                  <td />
                  <td className="tabular">
                    {row.date.slice(8)}/{row.date.slice(5, 7)}
                    {note === null ? null : (
                      <span className="ml-2 text-attention">{note}</span>
                    )}
                  </td>
                  <td>{row.description}</td>
                  <td className="max-md:hidden">{KIND_LABEL[row.kind]}</td>
                  <td className="text-ink-3 max-xl:hidden">{detail(row)}</td>
                  <td className="tabular text-right">
                    {row.amount === null ? '—' : money(row.amount, signOf(row.kind))}
                  </td>
                  <td data-launch>
                    {row.entry === null ? null : (
                      <button
                        type="button"
                        className="cursor-pointer"
                        onClick={() => {
                          void confirmPlanned(row.id).then(() => setReload((n) => n + 1));
                        }}
                      >
                        Lançar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        )}
        {sections.map((section) => (
          <tbody key={section.key}>
            <tr>
              <th scope="rowgroup" colSpan={7} className="pt-3 text-left text-ink-2">
                {section.label}
                {grouping === 'dia' ? null : (
                  <span className="ml-2 font-normal text-ink-3">{section.count}</span>
                )}
              </th>
            </tr>
            {section.rows.map((row) => (
              <tr
                key={row.id}
                data-situation={row.situation}
                tabIndex={0}
                onKeyDown={(e) => {
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
                }}
              >
                <td>
                  {selectable(row) ? (
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${row.description}`}
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                    />
                  ) : null}
                </td>
                <td className="tabular">
                  {row.date.slice(8)}/{row.date.slice(5, 7)}
                </td>
                <td>{row.description}</td>
                <td className="max-md:hidden">{KIND_LABEL[row.kind]}</td>
                <td className="text-ink-3 max-xl:hidden">{detail(row)}</td>
                <td className="tabular text-right">
                  {row.amount === null ? '—' : money(row.amount, signOf(row.kind))}
                </td>
                <td className="relative">
                  <button
                    type="button"
                    aria-label={`Ações de ${row.description}`}
                    aria-haspopup="menu"
                    aria-expanded={menuRow === row.id}
                    className="cursor-pointer px-2"
                    onClick={() => setMenuRow(menuRow === row.id ? null : row.id)}
                  >
                    ⋯
                  </button>
                  {menuRow === row.id ? (
                    <div
                      role="menu"
                      aria-label={`Menu de ${row.description}`}
                      className="absolute right-0 z-10 flex min-w-40 flex-col rounded-field border border-line bg-surface py-1 shadow-lg"
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setMenuRow(null);
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="cursor-pointer px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:text-ink-3"
                        disabled={!canMove(row)}
                        title={
                          canMove(row)
                            ? undefined
                            : 'Só despesa ou receita paga em conta muda de conta.'
                        }
                        onClick={() => openSingle(row, 'move')}
                      >
                        Mover de conta
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="cursor-pointer px-3 py-1.5 text-left text-negative disabled:cursor-not-allowed disabled:text-ink-3"
                        disabled={!canDelete(row)}
                        title={
                          canDelete(row)
                            ? undefined
                            : 'Pagamento de fatura sai pela fatura.'
                        }
                        onClick={() => openSingle(row, 'delete')}
                      >
                        Excluir
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <BatchDialog
        action={single?.action ?? null}
        chosen={single === null ? [] : [single.row]}
        accounts={accounts}
        hidden={hidden}
        onClose={() => setSingle(null)}
        onDone={() => setReload((n) => n + 1)}
      />
    </div>
  );
};
