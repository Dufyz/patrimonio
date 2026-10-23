import type { StatementResource, StatementRow } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchStatement } from '../api/statement.js';
import { deleteTransaction, moveTransaction, undoDeletion } from '../api/transactions.js';
import { Toolbar } from '../components/controls.js';
import { useEntry } from '../components/entry_provider.js';
import { Money, MoneyChange, Quantity } from '../components/number.js';
import { ConfirmDialog, Menu, Modal } from '../components/overlay.js';
import { KindBadge } from '../components/kind_badge.js';
import { KeepPrevious } from '../components/pending.js';
import { SkeletonRegion, SkeletonStats, SkeletonTable } from '../components/skeleton.js';
import { FilterBar, ToolbarIconButton, ToolbarSearch } from '../components/filter_bar.js';
import type { FilterField } from '../components/filter_bar.js';
import { useShortcuts } from '../components/shortcuts.js';
import { PeriodRangeBody } from '../components/period_control.js';
import { usePreferences } from '../components/preferences.js';
import { Button, IconButton, Label, Panel } from '../components/primitives.js';
import { useViewportWidth } from '../components/use_element_width.js';
import { assetSlug } from '../lib/asset_page.js';
import { DEFAULT_PERIOD, formatRange, resolvePeriod } from '../lib/period.js';
import type { Period } from '../lib/period.js';
import { formatShortDate } from '../lib/positions.js';
import {
  CSV_BOM,
  GROUP_LABELS,
  RECALCULATION_POLL_MS,
  STATEMENT_LIMIT,
  assetLabel,
  csvFilename,
  effectView,
  entriesLabel,
  groupToParam,
  groupsFromParam,
  listFromParam,
  listToParam,
  hasMarketColumns,
  isLedgerEntry,
  monthItems,
  monthName,
  monthTitle,
  periodFromParam,
  periodToParam,
  pruneSelection,
  rowLabel,
  selectionKinds,
  selectionState,
  sinceLabel,
  statementCsv,
  summaryItems,
  toggleAll,
  toggleSelected,
  typeDetail,
  typeLabel,
  valueCell,
} from '../lib/statement.js';
import { duplicateRequest } from '../lib/entry.js';
import { useResource } from '../lib/use_resource.js';
import { Icon } from '../components/icon.js';
import { Checkbox } from '../components/ui/checkbox.js';

/**
 * T-04 · Movimentações.
 *
 * O extrato do livro, que é onde se corrige o passado. A pergunta da tela não é
 * "quanto tenho", é "o que aconteceu, e o que cada lançamento mudou" — e por
 * isso a última coluna, Efeito, é a razão de a tela existir: ela diz, ao lado de
 * cada linha, o preço médio de antes e de depois, o resultado realizado, a
 * isenção. Quem confere uma nota da corretora olha para essa coluna.
 *
 * Nenhum número é calculado aqui. Resumo, subtotal de mês, contagem das
 * pastilhas e Efeito vêm da `api`, com o filtro já aplicado; é o que mantém o
 * subtotal de setembro certo quando setembro atravessa duas páginas.
 */

const todayIso = (): DateOnly => new Date().toISOString().slice(0, 10) as DateOnly;

export type StatementPortfolio = { readonly id: string; readonly name: string };

export type StatementScreenProps = {
  /** Nulo é o escopo de todas as carteiras. */
  readonly portfolioId: string | null;
  readonly scopeLabel: string;
  readonly portfolios: readonly StatementPortfolio[];
  /** Abre a página do ativo (T-03), na carteira do lançamento. */
  readonly onOpenAsset: (slug: string, portfolioId: string | null) => void;
};

type Notice =
  | {
      readonly kind: 'deleted';
      readonly count: number;
      readonly undoIds: readonly string[];
      readonly expiresAt: number;
      readonly failed: number;
    }
  | { readonly kind: 'restored' }
  | { readonly kind: 'moved'; readonly count: number; readonly failed: number }
  | { readonly kind: 'error'; readonly message: string };

const STATEMENT_COLUMNS = [
  { id: 'carteira', label: 'Carteira' },
  { id: 'qtd', label: 'Qtd' },
  { id: 'preco', label: 'Preço' },
  { id: 'taxas', label: 'Taxas' },
  { id: 'valor', label: 'Valor' },
  { id: 'instituicao', label: 'Instituição' },
  { id: 'efeito', label: 'Efeito' },
] as const;

export const StatementScreen = ({
  portfolioId,
  scopeLabel,
  portfolios,
  onOpenAsset,
}: StatementScreenProps): React.ReactElement => {
  const [params, setParams] = useSearchParams();
  const { hidden: valuesHidden, toggleHidden } = usePreferences();
  const width = useViewportWidth(1440);

  const today = todayIso();
  const rawGroup = params.get('grupo');
  const rawInstitution = params.get('instituicao');
  const groups = useMemo(() => groupsFromParam(rawGroup), [rawGroup]);
  const institutionIds = useMemo(() => listFromParam(rawInstitution), [rawInstitution]);
  const period = periodFromParam(params.get('periodo'));
  const search = params.get('busca') ?? '';

  const [draft, setDraft] = useState(search);
  const [hiddenColumns, setHiddenColumns] = useState<ReadonlySet<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const shortcuts = useMemo(() => ({ filter: () => setFilterOpen(true) }), []);
  useShortcuts(shortcuts);
  const [inception, setInception] = useState<DateOnly | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [moving, setMoving] = useState<readonly StatementRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<readonly StatementRow[] | null>(null);
  const entry = useEntry();

  const range = resolvePeriod(period, today, inception);

  /** O padrão nunca é escrito na URL. */
  const update = useCallback(
    (changes: Readonly<Record<string, string | null>>, replace = false): void => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace },
      );
    },
    [setParams],
  );

  useEffect(() => {
    if (draft === search) return;
    const timer = setTimeout(() => update({ busca: draft }, true), 250);
    return () => clearTimeout(timer);
  }, [draft, search, update]);

  useEffect(() => setDraft(search), [search]);

  const resource = useResource(
    (signal) =>
      fetchStatement(
        {
          portfolioId,
          institutionIds,
          groups,
          search,
          from: range.from,
          to: range.to,
          page: 1,
          limit: STATEMENT_LIMIT,
        },
        signal,
      ),
    [portfolioId, institutionIds, groups, search, range.from, range.to, entry.version],
  );

  const data: StatementResource | null =
    resource.state.kind === 'ready' ? resource.state.value : null;

  useEffect(() => {
    if (data !== null) setInception(data.scope.first_trade_date as DateOnly | null);
  }, [data]);

  // Página nova não herda a seleção da anterior: marcar uma linha que não está
  // à vista é o jeito de excluir o que ninguém conferiu.
  useEffect(() => {
    if (data !== null) setSelected((current) => pruneSelection(data.rows, current));
  }, [data]);

  // O recálculo muda a coluna Efeito. Enquanto houver carteira recalculando, a
  // tela relê sozinha: o banner promete que os números vão mudar, e cumpri-lo
  // é não exigir que a pessoa recarregue a página para ver.
  const recalculating = data !== null && data.recalculation.pending > 0;
  const { reload } = resource;
  useEffect(() => {
    if (!recalculating) return;
    const timer = setInterval(reload, RECALCULATION_POLL_MS);
    return () => clearInterval(timer);
  }, [recalculating, reload]);

  /** Duplicar abre um lançamento novo com os números da linha; a data volta a ser hoje. */
  const duplicate = (row: StatementRow | undefined): void => {
    const request = row === undefined ? null : duplicateRequest(row);
    if (request === null) return;
    entry.openEntry({
      tab: request.tab,
      asset: request.asset,
      portfolioId: request.portfolioId,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    });
  };

  const selectedRows = useMemo(
    () => (data === null ? [] : data.rows.filter((row) => selected.has(row.id))),
    [data, selected],
  );

  const onPeriodChange = (next: Period): void =>
    update({ periodo: periodToParam(next) }, true);

  const duplicating =
    selectedRows.length === 1 &&
    duplicateRequest(selectedRows[0] as StatementRow) !== null
      ? selectedRows[0]
      : null;

  const removeRows = async (rows: readonly StatementRow[]): Promise<void> => {
    setBusy(true);
    const undoIds: string[] = [];
    let expiresAt = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const receipt = await deleteTransaction(row.id);
        undoIds.push(receipt.undo.undo_id);
        expiresAt = Math.max(expiresAt, Date.parse(receipt.undo.expires_at));
      } catch {
        failed += 1;
      }
    }

    setBusy(false);
    setSelected(new Set());
    setNotice(
      undoIds.length === 0
        ? { kind: 'error', message: 'Não foi possível excluir. Nada foi alterado.' }
        : { kind: 'deleted', count: undoIds.length, undoIds, expiresAt, failed },
    );
    reload();
  };

  const undo = async (ids: readonly string[]): Promise<void> => {
    setBusy(true);
    try {
      for (const id of ids) await undoDeletion(id);
      setNotice({ kind: 'restored' });
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'Não foi possível desfazer.',
      });
    }
    setBusy(false);
    reload();
  };

  const moveRows = async (
    rows: readonly StatementRow[],
    targetPortfolioId: string,
  ): Promise<void> => {
    setBusy(true);
    let failed = 0;

    for (const row of rows) {
      try {
        await moveTransaction(row.id, targetPortfolioId);
      } catch {
        failed += 1;
      }
    }

    setBusy(false);
    setMoving(null);
    setSelected(new Set());
    setNotice({ kind: 'moved', count: rows.length - failed, failed });
    reload();
  };

  const exportRows = (rows: readonly StatementRow[]): void => {
    const blob = new Blob([CSV_BOM, statementCsv(rows)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = csvFilename(today);
    link.click();
    URL.revokeObjectURL(url);
  };

  const filtered = groups.length > 0 || search !== '' || institutionIds.length > 0;

  const periodLabel = formatRange(resolvePeriod(period, today, inception), today);
  const filterFields: readonly FilterField[] = [
    {
      kind: 'custom',
      id: 'data',
      label: 'Data',
      icon: 'calendar',
      value: periodLabel,
      onClear: () => onPeriodChange(DEFAULT_PERIOD),
      content: (close) => (
        <PeriodRangeBody
          value={period}
          onChange={onPeriodChange}
          today={today}
          inception={inception}
          onClose={close}
        />
      ),
    },
    {
      id: 'tipo',
      label: 'Tipo',
      icon: 'tag',
      options:
        data === null
          ? []
          : data.facets
              .filter(
                (facet) =>
                  (facet.group !== 'event' && facet.group !== 'custody') ||
                  facet.count > 0 ||
                  groups.includes(facet.group),
              )
              .map((facet) => ({
                id: groupToParam(facet.group),
                label: GROUP_LABELS[facet.group],
                count: facet.count,
              })),
      selected: groups.map((group) => groupToParam(group)),
      onChange: (ids) => update({ grupo: listToParam(ids) }),
    },
    {
      id: 'instituicao',
      label: 'Instituição',
      icon: 'bank',
      options:
        data === null
          ? []
          : data.institutions.map((institution) => ({
              id: institution.id,
              label: institution.name,
              count: institution.count,
            })),
      selected: institutionIds,
      onChange: (ids) => update({ instituicao: listToParam(ids) }),
    },
  ];
  const displayColumns = STATEMENT_COLUMNS.map((column) => ({
    ...column,
    hidden: hiddenColumns.has(column.id),
  }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-screen-title leading-7 font-semibold">Movimentações</h1>
          <p className="text-xs text-ink-3">
            {scopeLabel}
            {data === null || data.scope.first_trade_date === null
              ? ''
              : ` · ${entriesLabel(data.scope.entries_total)} desde ${sinceLabel(
                  data.scope.first_trade_date as DateOnly,
                )}`}
          </p>
        </div>

        <Toolbar>
          <IconButton
            label={valuesHidden ? 'Mostrar valores' : 'Ocultar valores'}
            aria-pressed={valuesHidden}
            onClick={toggleHidden}
          >
            <Icon name={valuesHidden ? 'eye-off' : 'eye'} />
          </IconButton>
          <Button
            variant="primary"
            icon="plus"
            shortcut="N"
            onClick={() => entry.openEntry()}
          >
            Lançamento
          </Button>
        </Toolbar>
      </header>

      {data === null ? (
        resource.state.kind === 'loading' ? (
          <SkeletonRegion label="Carregando o resumo do período">
            <SkeletonStats count={4} />
          </SkeletonRegion>
        ) : null
      ) : (
        <dl
          aria-label="Resumo do período"
          className="flex flex-wrap gap-x-6 gap-y-1 text-[0.8125rem] text-ink-2"
        >
          <div className="flex items-baseline gap-2">
            <dt>{formatRange(range, today)}</dt>
            <dd className="text-ink-3">· {entriesLabel(data.summary.count)}</dd>
          </div>
          {summaryItems(data.summary).map((item) => (
            <div key={item.key} className="flex items-baseline gap-2">
              <dt>{item.label}</dt>
              <dd className="font-semibold text-ink">
                <Money value={item.value} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {data !== null && data.recalculation.pending > 0 ? (
        <p
          role="status"
          className="rounded-control bg-accent-soft px-3 py-2 text-[0.8125rem] text-accent"
        >
          Recálculo em andamento: a coluna Efeito e os números de Posições vão mudar em
          instantes.
        </p>
      ) : null}

      {data !== null && data.recalculation.failed > 0 ? (
        <p
          role="alert"
          className="rounded-control bg-attention-soft px-3 py-2 text-[0.8125rem] text-attention"
        >
          O recálculo falhou em {data.recalculation.failed}{' '}
          {data.recalculation.failed === 1 ? 'carteira' : 'carteiras'}: a coluna Efeito
          pode estar desatualizada.
        </p>
      ) : null}

      <NoticeBar
        notice={notice}
        busy={busy}
        onUndo={undo}
        onDismiss={() => setNotice(null)}
      />

      <Panel>
        <FilterBar
          open={filterOpen}
          onOpenChange={setFilterOpen}
          extraCount={search === '' ? 0 : 1}
          search={
            <ToolbarSearch
              value={draft}
              label="Buscar lançamento"
              placeholder="Buscar lançamento"
              onChange={setDraft}
            />
          }
          fields={filterFields}
          display={{
            columns: displayColumns,
            onToggleColumn: (id) =>
              setHiddenColumns((current) => {
                const next = new Set(current);
                if (!next.delete(id)) next.add(id);
                return next;
              }),
          }}
          actions={
            <ToolbarIconButton
              label="Exportar CSV"
              icon="export"
              disabled={data === null || data.rows.length === 0}
              onClick={() =>
                data !== null &&
                exportRows(selectedRows.length > 0 ? selectedRows : data.rows)
              }
            />
          }
        />

        {selectedRows.length === 0 ? null : (
          <div
            role="toolbar"
            aria-label="Ações em lote"
            className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-accent-soft px-4 py-2"
          >
            <p className="text-[0.8125rem]">
              <strong className="font-semibold">
                {selectedRows.length}{' '}
                {selectedRows.length === 1 ? 'selecionado' : 'selecionados'}
              </strong>
              <span className="tabular text-xs text-ink-3">
                {' '}
                · {selectionKinds(selectedRows)}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                icon="arrow-right"
                disabled={busy}
                onClick={() => setMoving(selectedRows)}
              >
                Mover para carteira
              </Button>
              <Button
                icon="copy"
                disabled={busy || duplicating === null}
                title={
                  duplicating === null
                    ? 'Selecione um único lançamento de compra, venda ou provento'
                    : undefined
                }
                onClick={() => duplicate(selectedRows[0])}
              >
                Duplicar
              </Button>
              <Button
                icon="trash"
                className="text-negative hover:text-negative"
                disabled={busy}
                onClick={() => setToDelete(selectedRows)}
              >
                Excluir
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
            </div>
          </div>
        )}

        <div>
          {resource.state.kind === 'error' ? (
            <p role="alert" className="px-4 py-6 text-sm text-negative">
              {resource.state.error.message}
            </p>
          ) : (
            <KeepPrevious pending={resource.pending}>
              {data === null ? (
                <SkeletonRegion label="Carregando as movimentações">
                  <SkeletonTable rows={9} columns={7} />
                </SkeletonRegion>
              ) : (
                <StatementTable
                  data={data}
                  width={width}
                  selected={selected}
                  hidden={valuesHidden}
                  filtered={filtered}
                  hiddenColumns={hiddenColumns}
                  onToggle={(id) => setSelected((current) => toggleSelected(current, id))}
                  onToggleAll={() =>
                    setSelected((current) => toggleAll(data.rows, current))
                  }
                  onMove={(row) => setMoving([row])}
                  onEdit={(row) => entry.openEdit(row.id, assetLabel(row))}
                  onDuplicate={duplicate}
                  onDelete={(row) => setToDelete([row])}
                  onOpenAsset={(row) =>
                    onOpenAsset(
                      assetSlug({
                        asset_id: row.asset_id ?? '',
                        ticker: row.ticker ?? '',
                        name: row.asset_name ?? '',
                        b3_type: row.b3_type,
                      }),
                      row.portfolio_id,
                    )
                  }
                  onClear={() => update({ grupo: null, busca: null, instituicao: null })}
                />
              )}
            </KeepPrevious>
          )}
        </div>

        {data === null ? null : (
          <>
            {data.earlier === null ? null : (
              <div className="border-t border-line px-3 py-3 text-center text-sm">
                <button
                  type="button"
                  className="cursor-pointer font-medium text-accent hover:underline"
                  onClick={() =>
                    update({
                      periodo: periodToParam({
                        kind: 'custom',
                        from: `${data.earlier?.month ?? ''}-01` as DateOnly,
                        to: range.to,
                      }),
                    })
                  }
                >
                  Ampliar o período para {monthName(data.earlier.month)} ·{' '}
                  {entriesLabel(data.earlier.count)}
                </button>
              </div>
            )}
          </>
        )}

        <footer className="border-t border-line px-4 py-3 text-xs text-ink-3">
          A coluna Efeito mostra o que o lançamento mudou: preço médio, resultado
          realizado ou isenção.
        </footer>
      </Panel>

      <ConfirmDialog
        open={toDelete !== null}
        title={toDelete?.length === 1 ? 'Excluir lançamento?' : 'Excluir lançamentos?'}
        subject={toDelete === null ? '' : entriesLabel(toDelete.length)}
        consequence="O preço médio e o resultado de tudo que veio depois serão recalculados. Você terá alguns minutos para desfazer."
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          const rows = toDelete;
          setToDelete(null);
          if (rows !== null) void removeRows(rows);
        }}
      />

      <MoveDialog
        rows={moving}
        portfolios={portfolios}
        busy={busy}
        onCancel={() => setMoving(null)}
        onConfirm={(rows, target) => void moveRows(rows, target)}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */

type MonthSection = {
  readonly month: string;
  readonly rows: readonly StatementRow[];
};

/** As linhas chegam por data decrescente: um mês é uma corrida de linhas vizinhas. */
const sections = (rows: readonly StatementRow[]): readonly MonthSection[] => {
  const result: { month: string; rows: StatementRow[] }[] = [];
  for (const row of rows) {
    const month = row.trade_date.slice(0, 7);
    const last = result[result.length - 1];
    if (last?.month === month) last.rows.push(row);
    else result.push({ month, rows: [row] });
  }
  return result;
};

const TONE_CLASS = {
  neutral: 'text-ink-2',
  positive: 'text-positive',
  negative: 'text-negative',
  attention: 'text-attention',
} as const;

const Dash = (): React.ReactElement => <span className="text-ink-3">—</span>;

const StatementTable = ({
  data,
  width,
  selected,
  hidden,
  filtered,
  hiddenColumns,
  onToggle,
  onToggleAll,
  onMove,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenAsset,
  onClear,
}: {
  readonly data: StatementResource;
  readonly width: number;
  readonly selected: ReadonlySet<string>;
  readonly hidden: boolean;
  readonly filtered: boolean;
  readonly hiddenColumns: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onToggleAll: () => void;
  readonly onMove: (row: StatementRow) => void;
  readonly onEdit: (row: StatementRow) => void;
  readonly onDuplicate: (row: StatementRow) => void;
  readonly onDelete: (row: StatementRow) => void;
  readonly onOpenAsset: (row: StatementRow) => void;
  readonly onClear: () => void;
}): React.ReactElement => {
  const state = selectionState(data.rows, selected);

  // A prancha 18: coluna secundária some em etapas, a tabela não rola de lado.
  const shown = (id: string): boolean => !hiddenColumns.has(id);
  const showQuantity = width >= 1000 && shown('qtd');
  const showPrice = width >= 1100 && shown('preco');
  const showFees = width >= 1100 && shown('taxas');
  const showInstitution = width >= 1400 && shown('instituicao');
  const showValue = shown('valor');
  const showEffect = shown('efeito');
  // Todas as carteiras: sem a coluna, duas compras iguais em carteiras
  // diferentes seriam a mesma linha duas vezes.
  const showPortfolio = data.scope.portfolio_id === null && shown('carteira');

  const monthTotals = new Map(data.months.map((month) => [month.month, month]));
  const columns =
    4 +
    [
      showQuantity,
      showPrice,
      showFees,
      showInstitution,
      showPortfolio,
      showValue,
      showEffect,
    ].filter(Boolean).length;

  if (data.rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-10">
        <p className="text-sm">
          {filtered
            ? 'Nenhum lançamento corresponde ao filtro.'
            : data.scope.entries_total === 0
              ? 'Ainda não há lançamentos.'
              : 'Nenhum lançamento neste período.'}
        </p>
        {filtered ? <Button onClick={onClear}>Limpar filtros</Button> : null}
      </div>
    );
  }

  const header =
    'px-3 py-[9px] tabular text-label font-medium tracking-[0.06em] whitespace-nowrap text-ink-3 uppercase';

  return (
    <table className="w-full table-auto border-collapse text-cell">
      <caption className="sr-only">Lançamentos do período</caption>
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="w-10 py-[9px] pr-0 pl-4">
            <Checkbox
              aria-label="Selecionar todos os lançamentos da página"
              checked={
                state === 'all' ? true : state === 'some' ? 'indeterminate' : false
              }
              onCheckedChange={onToggleAll}
            />
          </th>
          <th scope="col" className={`${header} text-left`}>
            Data
          </th>
          <th scope="col" className={`${header} text-left`}>
            Tipo
          </th>
          <th scope="col" className={`${header} text-left`}>
            Ativo
          </th>
          {showPortfolio ? (
            <th scope="col" className={`${header} text-left`}>
              Carteira
            </th>
          ) : null}
          {showQuantity ? (
            <th scope="col" className={`${header} text-right`}>
              Qtd
            </th>
          ) : null}
          {showPrice ? (
            <th scope="col" className={`${header} text-right`}>
              Preço
            </th>
          ) : null}
          {showFees ? (
            <th scope="col" className={`${header} text-right`}>
              Taxas
            </th>
          ) : null}
          {showValue ? (
            <th scope="col" className={`${header} text-right`}>
              Valor
            </th>
          ) : null}
          {showInstitution ? (
            <th scope="col" className={`${header} text-left`}>
              Instituição
            </th>
          ) : null}
          {showEffect ? (
            <th scope="col" className={`${header} text-left`}>
              Efeito
            </th>
          ) : null}
          <th scope="col" className="w-11" />
        </tr>
      </thead>

      {sections(data.rows).map((section) => {
        const total = monthTotals.get(section.month);
        return (
          <tbody key={section.month}>
            <tr className="border-b border-line bg-panel-2">
              <th
                scope="colgroup"
                colSpan={4}
                className="py-(--row-pad) px-4 text-left font-semibold"
              >
                {monthTitle(section.month)}
              </th>
              <td
                colSpan={columns - 3}
                className="tabular px-4 text-right text-xs font-normal text-ink-3"
              >
                {total === undefined
                  ? null
                  : monthItems(total).map((item, index) => (
                      <span key={item.key}>
                        {index === 0 ? '' : ' · '}
                        {item.label} <Money value={item.value} />
                      </span>
                    ))}
              </td>
            </tr>

            {section.rows.map((row) => (
              <StatementLine
                key={row.id}
                row={row}
                checked={selected.has(row.id)}
                hidden={hidden}
                showQuantity={showQuantity}
                showPrice={showPrice}
                showFees={showFees}
                showInstitution={showInstitution}
                showValue={showValue}
                showEffect={showEffect}
                showPortfolio={showPortfolio}
                onToggle={() => onToggle(row.id)}
                onMove={() => onMove(row)}
                onEdit={() => onEdit(row)}
                onDuplicate={() => onDuplicate(row)}
                onDelete={() => onDelete(row)}
                onOpenAsset={() => onOpenAsset(row)}
              />
            ))}
          </tbody>
        );
      })}
    </table>
  );
};

const StatementLine = ({
  row,
  checked,
  hidden,
  showQuantity,
  showPrice,
  showFees,
  showInstitution,
  showValue,
  showEffect,
  showPortfolio,
  onToggle,
  onMove,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenAsset,
}: {
  readonly row: StatementRow;
  readonly checked: boolean;
  readonly hidden: boolean;
  readonly showQuantity: boolean;
  readonly showPrice: boolean;
  readonly showFees: boolean;
  readonly showInstitution: boolean;
  readonly showValue: boolean;
  readonly showEffect: boolean;
  readonly showPortfolio: boolean;
  readonly onToggle: () => void;
  readonly onMove: () => void;
  readonly onEdit: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onOpenAsset: () => void;
}): React.ReactElement => {
  const market = hasMarketColumns(row);
  const value = valueCell(row);
  const effect = effectView(row.effect, hidden);
  const detail = typeDetail(row);
  const ledger = isLedgerEntry(row);
  const editable = ledger && row.kind !== 'corporate_event';

  // Os atalhos que o menu anuncia: E edita, D duplica, ⌫ exclui, X marca.
  const onKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>): void => {
    if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (key === 'e' && editable) onEdit();
    else if (key === 'd' && ledger && duplicateRequest(row) !== null) onDuplicate();
    else if (key === 'x' && ledger) onToggle();
    else if ((key === 'backspace' || key === 'delete') && ledger) onDelete();
    else return;
    event.preventDefault();
  };

  return (
    <tr
      data-row-id={row.id}
      aria-label={rowLabel(row)}
      aria-selected={checked}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`group border-b border-line outline-offset-[-2px] ${checked ? 'bg-accent-soft' : 'hover:bg-panel-2'}`}
    >
      <td className="py-(--row-pad) pr-0 pl-4">
        {ledger ? (
          <Checkbox
            aria-label={`Selecionar ${rowLabel(row)}`}
            checked={checked}
            onCheckedChange={onToggle}
          />
        ) : null}
      </td>
      <td
        className="tabular px-3 py-(--row-pad) whitespace-nowrap"
        title={row.trade_date}
      >
        {formatShortDate(row.trade_date)}
      </td>
      <td className="px-3 py-(--row-pad) whitespace-nowrap">
        <KindBadge kind={row.kind}>{typeLabel(row)}</KindBadge>
        {detail === null ? null : <span className="ml-2 text-ink-3">{detail}</span>}
      </td>
      <td className="max-w-0 min-w-32 px-3 py-(--row-pad) font-medium">
        <span className="block truncate" title={row.asset_name ?? undefined}>
          {assetLabel(row)}
        </span>
      </td>
      {showPortfolio ? (
        <td className="max-w-0 min-w-24 px-3 py-(--row-pad) text-ink-2">
          <span className="block truncate" title={row.portfolio_name}>
            {row.portfolio_name}
          </span>
        </td>
      ) : null}
      {showQuantity ? (
        <td className="px-3 py-(--row-pad) text-right whitespace-nowrap">
          {market ? <Quantity value={row.quantity} /> : <Dash />}
        </td>
      ) : null}
      {showPrice ? (
        <td className="px-3 py-(--row-pad) text-right whitespace-nowrap">
          {market ? <Money value={row.unit_price} /> : <Dash />}
        </td>
      ) : null}
      {showFees ? (
        <td className="px-3 py-(--row-pad) text-right whitespace-nowrap">
          {market && row.kind !== 'payout' ? <Money value={row.fees} /> : <Dash />}
        </td>
      ) : null}
      {showValue ? (
        <td className="px-3 py-(--row-pad) text-right font-medium whitespace-nowrap">
          {!ledger ? (
            <Dash />
          ) : value.signed ? (
            <MoneyChange value={value.value} />
          ) : (
            <Money value={value.value} />
          )}
        </td>
      ) : null}
      {showInstitution ? (
        <td className="max-w-0 min-w-24 px-3 py-(--row-pad) text-ink-2">
          <span className="block truncate">{row.institution_name ?? '—'}</span>
        </td>
      ) : null}
      {showEffect ? (
        <td className={`max-w-0 min-w-40 px-3 py-(--row-pad) ${TONE_CLASS[effect.tone]}`}>
          <span className="block truncate" title={effect.text}>
            {effect.text}
          </span>
        </td>
      ) : null}
      <td className="w-11 px-1.5 py-1">
        <Menu
          label={`Ações de ${rowLabel(row)}`}
          items={[
            {
              id: 'edit',
              label: 'Editar',
              icon: <Icon name="pencil" />,
              shortcut: 'E',
              // Evento corporativo não se edita aqui.
              hint: editable ? undefined : 'Evento não é editado aqui',
              disabled: !editable,
              onSelect: onEdit,
            },
            {
              id: 'duplicate',
              label: 'Duplicar',
              icon: <Icon name="copy" />,
              shortcut: 'D',
              disabled: duplicateRequest(row) === null,
              onSelect: onDuplicate,
            },
            {
              id: 'move',
              label: 'Mover para outra carteira',
              icon: <Icon name="arrow-right" />,
              onSelect: onMove,
            },
            ...(row.asset_id === null
              ? []
              : [
                  {
                    id: 'open_asset',
                    label: 'Abrir ativo',
                    icon: <Icon name="tag" />,
                    onSelect: onOpenAsset,
                  },
                ]),
            {
              id: 'delete',
              label: 'Excluir',
              icon: <Icon name="trash" />,
              shortcut: '⌫',
              destructive: true,
              onSelect: onDelete,
            },
          ].filter((item) => ledger || item.id === 'open_asset')}
        />
      </td>
    </tr>
  );
};

/* -------------------------------------------------------------------------- */

/**
 * Excluir não pede confirmação: oferece desfazer. A confirmação protege de um
 * clique errado e não ensina nada; o desfazer protege do mesmo clique e ainda
 * deixa a pessoa ver o que mudou antes de decidir. O aviso diz, sem enfeite,
 * que o recálculo foi enfileirado — é ele que muda o preço médio do que veio
 * depois.
 */
const NoticeBar = ({
  notice,
  busy,
  onUndo,
  onDismiss,
}: {
  readonly notice: Notice | null;
  readonly busy: boolean;
  readonly onUndo: (ids: readonly string[]) => void;
  readonly onDismiss: () => void;
}): React.ReactElement | null => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (notice?.kind !== 'deleted') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [notice]);

  if (notice === null) return null;

  const tone =
    notice.kind === 'error' ? 'bg-negative-soft text-negative' : 'bg-panel-2 text-ink';

  const text =
    notice.kind === 'deleted'
      ? `${entriesLabel(notice.count)} ${notice.count === 1 ? 'excluído' : 'excluídos'}. Recálculo enfileirado: preço médio e resultado de tudo que veio depois serão refeitos.${
          notice.failed > 0 ? ` ${notice.failed} não puderam ser excluídos.` : ''
        }`
      : notice.kind === 'restored'
        ? 'Exclusão desfeita. Recálculo enfileirado.'
        : notice.kind === 'moved'
          ? `${entriesLabel(notice.count)} ${notice.count === 1 ? 'movido' : 'movidos'}. Recálculo enfileirado nas duas carteiras.${
              notice.failed > 0 ? ` ${notice.failed} não puderam ser movidos.` : ''
            }`
          : notice.message;

  const canUndo = notice.kind === 'deleted' && notice.expiresAt > now;

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-control px-3 py-2 text-[0.8125rem] ${tone}`}
    >
      <span>{text}</span>
      <span className="flex items-center gap-2">
        {canUndo ? (
          <Button disabled={busy} onClick={() => onUndo(notice.undoIds)}>
            Desfazer
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onDismiss}>
          Fechar
        </Button>
      </span>
    </div>
  );
};

const MoveDialog = ({
  rows,
  portfolios,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly rows: readonly StatementRow[] | null;
  readonly portfolios: readonly StatementPortfolio[];
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (rows: readonly StatementRow[], portfolioId: string) => void;
}): React.ReactElement => {
  const [target, setTarget] = useState('');

  useEffect(() => setTarget(''), [rows]);

  const origins = new Set((rows ?? []).map((row) => row.portfolio_id));
  const options = portfolios.filter(
    (portfolio) => origins.size !== 1 || !origins.has(portfolio.id),
  );

  return (
    <Modal
      open={rows !== null}
      title="Mover para outra carteira"
      subtitle={rows === null ? undefined : entriesLabel(rows.length)}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={busy || target === '' || rows === null}
            onClick={() => rows !== null && onConfirm(rows, target)}
          >
            Mover
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-sm">
        <Label>Carteira de destino</Label>
        <select
          data-autofocus
          value={target}
          className="h-control rounded-control border border-line bg-panel px-2"
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">Escolha a carteira</option>
          {options.map((portfolio) => (
            <option key={portfolio.id} value={portfolio.id}>
              {portfolio.name}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-3 text-[0.8125rem] text-ink-2">
        O preço médio das duas carteiras é refeito: o recálculo fica enfileirado e a
        coluna Efeito se atualiza quando ele termina.
      </p>
    </Modal>
  );
};
