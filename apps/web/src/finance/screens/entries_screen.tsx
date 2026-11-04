import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { Button } from '../../components/primitives.js';
import { EntryDialog } from '../components/entry_dialog.js';
import { ConfirmDialog, MoveAccountDialog } from '../components/entry_confirms.js';
import {
  addEntry,
  deleteEntries,
  deleteImpact,
  draftOfEntry,
  emptyEntryDraft,
  launchEntry,
  moveAccount,
  moveBlockedReason,
  recategorize,
  updateEntry,
} from '../domain/entry_ops.js';
import { formatBRL } from '../lib/format.js';
import { financeRoutes } from '../lib/routes.js';
import type { Entry } from '../domain/types.js';

import { browserStorage } from '../../lib/preferences.js';
import { GROUPING_SUBTITLES, GroupSelector } from '../components/group_selector.js';
import { LedgerStrip } from '../components/ledger_strip.js';
import { LedgerTable } from '../components/ledger_table.js';
import { PeriodControl } from '../components/period_control.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { ScreenHeader } from '../components/screen_header.js';
import { TableToolbar } from '../components/table_toolbar.js';
import { groupEntries } from '../domain/ledger_groups.js';
import { indicators as computeIndicators, queryEntries } from '../domain/ledger.js';
import { SOURCES } from '../domain/sources.js';
import { readHiddenColumns, writeHiddenColumns } from '../lib/columns.js';
import type { ColumnSpec } from '../lib/columns.js';
import { EMPTY_FILTERS } from '../lib/filters.js';
import type { FilterField, FilterState } from '../lib/filters.js';
import { PRIMARY_LABELS, pluralize } from '../lib/header.js';
import { readEntryGrouping, writeEntryGrouping } from '../lib/preferences.js';
import type { EntryGrouping } from '../lib/preferences.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';

/**
 * Lançamentos: o que entrou, o que saiu e o que ainda falta lançar no período.
 * Esta tela cresce história a história (FIN-301 a FIN-311).
 */

const SCREEN = 'lancamentos';

const COLUMNS: readonly ColumnSpec[] = [
  { id: 'data', label: 'Data' },
  { id: 'descricao', label: 'Descrição', locked: true },
  { id: 'categoria', label: 'Categoria' },
  { id: 'conta', label: 'Conta' },
  { id: 'detalhe', label: 'Detalhe' },
  { id: 'valor', label: 'Valor', locked: true },
];

export const EntriesScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const store = useFinanceStore();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [launching, setLaunching] = useState<Entry | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [deleting, setDeleting] = useState<Entry | null>(null);
  const [moving, setMoving] = useState<Entry | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const { range, setRange, today } = useFinancePeriod();

  const [grouping, setGrouping] = useState<EntryGrouping>(() =>
    readEntryGrouping(browserStorage()),
  );
  const [search, setSearch] = useState('');
  // O link do Extrato ("Ver em Lançamentos com filtro desta conta") chega com `?conta=`.
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<FilterState>(() => {
    const account = params.get('conta');
    return account === null ? EMPTY_FILTERS : { conta: [account] };
  });
  const [hidden, setHidden] = useState(() =>
    readHiddenColumns(browserStorage(), SCREEN, COLUMNS),
  );

  const filterFields: readonly FilterField[] = useMemo(
    () => [
      {
        id: 'tipo',
        label: 'Tipo',
        options: [
          { value: 'receita', label: 'Receita' },
          { value: 'despesa', label: 'Despesa' },
        ],
      },
      {
        id: 'categoria',
        label: 'Categoria',
        options: data.categories.map((c) => ({ value: c.id, label: c.name })),
      },
      {
        id: 'conta',
        label: 'Conta',
        options: SOURCES.map((s) => ({ value: s.id, label: s.name })),
      },
      {
        id: 'situacao',
        label: 'Situação',
        options: [
          { value: 'lancada', label: 'Lançado' },
          { value: 'prevista', label: 'Previsto' },
        ],
      },
    ],
    [data.categories],
  );

  const entries = useMemo(
    () => queryEntries(data, search, filters),
    [data, search, filters],
  );
  const groups = useMemo(
    () => groupEntries(grouping, entries, range, data.categories),
    [grouping, entries, range, data.categories],
  );
  const indicators = useMemo(() => computeIndicators(entries, range), [entries, range]);
  const shown = groups.reduce((total, group) => total + group.entries.length, 0);

  return (
    <>
      <ScreenHeader
        title="Lançamentos"
        subtitle={`Todas as contas e cartões · ${GROUPING_SUBTITLES[grouping]}`}
        period={<PeriodControl value={range} onChange={setRange} today={today} />}
        primary={{ label: PRIMARY_LABELS.entries, onClick: () => setCreating(true) }}
      />
      <div className="flex flex-col gap-4">
        <LedgerStrip indicators={indicators} range={range} today={today} />
        <div className="rounded-panel border border-line bg-panel">
          <TableToolbar
            searchPlaceholder="Buscar lançamento"
            search={search}
            onSearch={setSearch}
            counter={pluralize(shown, 'lançamento', 'lançamentos')}
            group={
              <GroupSelector
                value={grouping}
                onChange={(next) => {
                  setGrouping(next);
                  writeEntryGrouping(browserStorage(), next);
                }}
              />
            }
            filterFields={filterFields}
            filters={filters}
            onFilters={setFilters}
            columns={COLUMNS}
            hiddenColumns={hidden}
            onHiddenColumns={(next) => {
              setHidden(next);
              writeHiddenColumns(browserStorage(), SCREEN, next);
            }}
            onExport={() => {}}
          />
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 border-t border-line px-4 py-12 text-center">
              <p className="text-[0.8125rem] text-ink-3">
                Nenhum lançamento com esses filtros.
              </p>
              <Button
                onClick={() => {
                  setSearch('');
                  setFilters(EMPTY_FILTERS);
                }}
              >
                Limpar filtros
              </Button>
            </div>
          ) : null}
          <LedgerTable
            groups={groups}
            categories={data.categories}
            today={today}
            hiddenColumns={hidden}
            onLaunch={setLaunching}
            actions={{
              onEdit: setEditing,
              onDelete: setDeleting,
              onMove: (entry) => {
                const reason = moveBlockedReason(entry);
                if (reason === null) setMoving(entry);
                else setBlocked(reason);
              },
              onCategory: (entry, categoryId) =>
                store.set((current) => recategorize(current, [entry.id], categoryId)),
            }}
          />
        </div>
      </div>

      {creating ? (
        <EntryDialog
          mode="new"
          data={data}
          today={today}
          initial={emptyEntryDraft(today)}
          onClose={() => setCreating(false)}
          onCreateRecurring={() => navigate(financeRoutes.recurrings())}
          onSave={(draft) => {
            store.set((current) => addEntry(current, draft, today));
            setCreating(false);
          }}
        />
      ) : null}
      {editing === null ? null : (
        <EntryDialog
          mode="edit"
          data={data}
          today={today}
          initial={draftOfEntry(editing, today)}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            store.set((current) => updateEntry(current, editing.id, draft, today));
            setEditing(null);
          }}
        />
      )}
      {deleting === null ? null : (
        <ConfirmDialog
          title="Excluir lançamento"
          confirmLabel="Excluir"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            store.set((current) => deleteEntries(current, [deleting.id]));
            setDeleting(null);
          }}
        >
          <p>
            Excluir “{deleting.description}” ({formatBRL(deleting.cents)})? O efeito dele
            nos saldos e na fatura é revertido: {deleteImpact([deleting])}.
          </p>
          {deleting.recurringId === undefined ? null : (
            <p>Como veio de um recorrente, o previsto do mês não volta a ser gerado.</p>
          )}
        </ConfirmDialog>
      )}
      {moving === null ? null : (
        <MoveAccountDialog
          entries={[moving]}
          onClose={() => setMoving(null)}
          onConfirm={(sourceId) => {
            store.set((current) => moveAccount(current, [moving.id], sourceId));
            setMoving(null);
          }}
        />
      )}
      {blocked === null ? null : (
        <ConfirmDialog
          title="Não dá para mover"
          confirmLabel="Entendi"
          onClose={() => setBlocked(null)}
          onConfirm={() => setBlocked(null)}
        >
          <p>{blocked}</p>
        </ConfirmDialog>
      )}
      {launching === null ? null : (
        <EntryDialog
          mode="launch"
          data={data}
          today={today}
          initial={draftOfEntry(launching, today)}
          onClose={() => setLaunching(null)}
          onSave={(draft) => {
            store.set((current) => launchEntry(current, launching.id, draft, today));
            setLaunching(null);
          }}
        />
      )}
    </>
  );
};
