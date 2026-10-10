import type { StatementResource, StatementRow } from '@patrimonio/contracts';
import type { DateOnly } from '@patrimonio/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchStatement } from '../api/statement.js';
import { deleteTransaction, moveTransaction, undoDeletion } from '../api/transactions.js';
import { Toolbar } from '../components/controls.js';
import { useEntry } from '../components/entry_provider.js';
import { Money, MoneyChange, Quantity } from '../components/number.js';
import { Menu, Modal } from '../components/overlay.js';
import { KeepPrevious } from '../components/pending.js';
import { PeriodControl } from '../components/period_control.js';
import { usePreferences } from '../components/preferences.js';
import { Button, Chip, IconButton, Label, Panel } from '../components/primitives.js';
import { useViewportWidth } from '../components/use_element_width.js';
import { assetSlug } from '../lib/asset_page.js';
import { formatRange, resolvePeriod } from '../lib/period.js';
import type { Period } from '../lib/period.js';
import { formatShortDate } from '../lib/positions.js';
import {
  CSV_BOM,
  GROUP_LABELS,
  RECALCULATION_POLL_MS,
  STATEMENT_PAGE_SIZE,
  assetLabel,
  csvFilename,
  effectView,
  entriesLabel,
  groupFromParam,
  groupToParam,
  hasMarketColumns,
  monthItems,
  monthName,
  monthTitle,
  pageFromParam,
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
  readonly portfolioId: string;
  readonly scopeLabel: string;
  readonly portfolios: readonly StatementPortfolio[];
  /** Abre a página do ativo (T-03), pelo apelido dele no endereço. */
  readonly onOpenAsset: (slug: string) => void;
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
  const group = groupFromParam(params.get('grupo'));
  const period = periodFromParam(params.get('periodo'));
  const search = params.get('busca') ?? '';
  const institutionId = params.get('instituicao');
  const pageNumber = pageFromParam(params.get('pagina'));

  const [draft, setDraft] = useState(search);
  const [inception, setInception] = useState<DateOnly | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [moving, setMoving] = useState<readonly StatementRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const entry = useEntry();

  const range = resolvePeriod(period, today, inception);

  /** Mudar qualquer filtro volta para a primeira página, e o padrão some da URL. */
  const update = useCallback(
    (changes: Readonly<Record<string, string | null>>, replace = false): void => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (!('pagina' in changes)) next.delete('pagina');
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '' || (key === 'pagina' && value === '1')) {
              next.delete(key);
            } else next.set(key, value);
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
          institutionId,
          group,
          search,
          from: range.from,
          to: range.to,
          page: pageNumber,
          limit: STATEMENT_PAGE_SIZE,
        },
        signal,
      ),
    [
      portfolioId,
      institutionId,
      group,
      search,
      range.from,
      range.to,
      pageNumber,
      entry.version,
    ],
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

  const filtered = group !== null || search !== '' || institutionId !== null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[1.375rem] leading-7 font-semibold">Movimentações</h1>
          <p className="text-[0.8125rem] text-ink-3">
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
            {valuesHidden ? '⦰' : '◉'}
          </IconButton>
          <Button variant="primary" shortcut="N" onClick={() => entry.openEntry()}>
            Lançamento
          </Button>
        </Toolbar>
      </header>

      {data === null ? null : (
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
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <PeriodControl
            value={period}
            onChange={onPeriodChange}
            today={today}
            inception={inception}
          />

          {data === null ? null : (
            <div
              role="group"
              aria-label="Filtrar por tipo"
              className="flex flex-wrap gap-2"
            >
              <Chip
                selected={group === null}
                count={data.facets_total}
                onClick={() => update({ grupo: null })}
              >
                Todos
              </Chip>
              {data.facets
                .filter(
                  (facet) =>
                    facet.group !== 'event' || facet.count > 0 || group === 'event',
                )
                .map((facet) => (
                  <Chip
                    key={facet.group}
                    selected={group === facet.group}
                    count={facet.count}
                    onClick={() =>
                      update({
                        grupo: group === facet.group ? null : groupToParam(facet.group),
                      })
                    }
                  >
                    {GROUP_LABELS[facet.group]}
                  </Chip>
                ))}
            </div>
          )}

          <input
            type="search"
            value={draft}
            aria-label="Buscar lançamento"
            placeholder="Ativo"
            className="h-control w-40 rounded-control border border-line bg-panel px-3 text-sm"
            onChange={(event) => setDraft(event.target.value)}
          />

          {data === null || data.institutions.length < 2 ? null : (
            <select
              aria-label="Instituição"
              value={institutionId ?? ''}
              className="h-control rounded-control border border-line bg-panel px-2 text-sm"
              onChange={(event) => update({ instituicao: event.target.value })}
            >
              <option value="">Todas as instituições</option>
              {data.institutions.map((institution) => (
                <option key={institution.id} value={institution.id}>
                  {institution.name} · {institution.count}
                </option>
              ))}
            </select>
          )}
        </div>

        {selectedRows.length === 0 ? null : (
          <div
            role="toolbar"
            aria-label="Ações em lote"
            className="flex flex-wrap items-center justify-between gap-3 bg-accent-soft px-4 py-2"
          >
            <p className="text-sm">
              <strong className="font-semibold">
                {selectedRows.length}{' '}
                {selectedRows.length === 1 ? 'selecionado' : 'selecionados'}
              </strong>
              <span className="text-ink-3"> · {selectionKinds(selectedRows)}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy} onClick={() => setMoving(selectedRows)}>
                Mover para carteira
              </Button>
              <Button
                disabled={busy || duplicating === null}
                title={
                  duplicating === null
                    ? 'Selecione um único lançamento de compra, venda, provento, aporte ou resgate'
                    : undefined
                }
                onClick={() => duplicate(selectedRows[0])}
              >
                Duplicar
              </Button>
              <Button disabled={busy} onClick={() => exportRows(selectedRows)}>
                Exportar CSV
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void removeRows(selectedRows)}
              >
                Excluir
              </Button>
              <Button variant="ghost" onClick={() => setSelected(new Set())}>
                Limpar seleção
              </Button>
            </div>
          </div>
        )}

        <div className="py-1">
          {resource.state.kind === 'error' ? (
            <p role="alert" className="px-4 py-6 text-sm text-negative">
              {resource.state.error.message}
            </p>
          ) : (
            <KeepPrevious pending={resource.pending}>
              {data === null ? null : (
                <StatementTable
                  data={data}
                  width={width}
                  selected={selected}
                  hidden={valuesHidden}
                  filtered={filtered}
                  onToggle={(id) => setSelected((current) => toggleSelected(current, id))}
                  onToggleAll={() =>
                    setSelected((current) => toggleAll(data.rows, current))
                  }
                  onMove={(row) => setMoving([row])}
                  onEdit={(row) => entry.openEdit(row.id, assetLabel(row))}
                  onDuplicate={duplicate}
                  onDelete={(row) => void removeRows([row])}
                  onOpenAsset={(row) =>
                    onOpenAsset(
                      assetSlug({
                        asset_id: row.asset_id ?? '',
                        ticker: row.ticker ?? '',
                        name: row.asset_name ?? '',
                        b3_type: row.b3_type,
                      }),
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

            <Pagination
              page={data.page.number}
              limit={data.page.limit}
              total={data.page.total}
              onChange={(next) => update({ pagina: String(next) })}
            />
          </>
        )}
      </Panel>

      <footer className="px-1 text-[0.75rem] text-ink-3">
        A coluna Efeito mostra o que o lançamento mudou: preço médio, resultado realizado
        ou isenção.
      </footer>

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

const KIND_PILL: Readonly<Record<StatementRow['kind'], string>> = {
  buy: 'bg-accent-soft text-accent',
  sell: 'bg-attention-soft text-attention',
  payout: 'bg-positive-soft text-positive',
  deposit: 'bg-panel-2 text-ink-2',
  withdrawal: 'bg-panel-2 text-ink-2',
  transfer: 'bg-panel-2 text-ink-2',
  corporate_event: 'bg-panel-2 text-ink-2',
};

const Dash = (): React.ReactElement => <span className="text-ink-3">—</span>;

const StatementTable = ({
  data,
  width,
  selected,
  hidden,
  filtered,
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
  readonly onToggle: (id: string) => void;
  readonly onToggleAll: () => void;
  readonly onMove: (row: StatementRow) => void;
  readonly onEdit: (row: StatementRow) => void;
  readonly onDuplicate: (row: StatementRow) => void;
  readonly onDelete: (row: StatementRow) => void;
  readonly onOpenAsset: (row: StatementRow) => void;
  readonly onClear: () => void;
}): React.ReactElement => {
  const master = useRef<HTMLInputElement>(null);
  const state = selectionState(data.rows, selected);

  useEffect(() => {
    if (master.current !== null) master.current.indeterminate = state === 'some';
  }, [state]);

  // A prancha 18: coluna secundária some em etapas, a tabela não rola de lado.
  const showQuantity = width >= 1000;
  const showPrice = width >= 1100;
  const showFees = width >= 1100;
  const showInstitution = width >= 1400;

  const monthTotals = new Map(data.months.map((month) => [month.month, month]));
  const columns =
    6 + [showQuantity, showPrice, showFees, showInstitution].filter(Boolean).length;

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
    'px-2.5 pb-2 text-label font-medium tracking-wide whitespace-nowrap text-ink-3 uppercase';

  return (
    <table className="w-full table-auto border-collapse text-cell">
      <caption className="sr-only">Lançamentos do período</caption>
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="w-9 pb-2 pl-4">
            <input
              ref={master}
              type="checkbox"
              aria-label="Selecionar todos os lançamentos da página"
              checked={state === 'all'}
              onChange={onToggleAll}
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
          <th scope="col" className={`${header} text-right`}>
            Valor
          </th>
          {showInstitution ? (
            <th scope="col" className={`${header} text-left`}>
              Instituição
            </th>
          ) : null}
          <th scope="col" className={`${header} text-left`}>
            Efeito
          </th>
          <th scope="col" className="w-8" />
        </tr>
      </thead>

      {sections(data.rows).map((section) => {
        const total = monthTotals.get(section.month);
        return (
          <tbody key={section.month}>
            <tr className="bg-panel-2">
              <th
                scope="colgroup"
                colSpan={4}
                className="h-(--row-height-group) px-4 text-left font-semibold"
              >
                {monthTitle(section.month)}
              </th>
              <td
                colSpan={columns - 3}
                className="tabular px-2.5 text-right text-[0.75rem] font-normal text-ink-3"
              >
                {total === undefined
                  ? null
                  : monthItems(total).map((item, index) => (
                      <span key={item.key}>
                        {index === 0 ? '' : ' · '}
                        {item.label} <Money value={item.value} bare />
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
  const editable = row.transfer_group_id === null && row.kind !== 'corporate_event';

  return (
    <tr
      data-row-id={row.id}
      aria-label={rowLabel(row)}
      aria-selected={checked}
      className={`group border-b border-line/60 ${checked ? 'bg-accent-soft' : 'hover:bg-panel-2'}`}
    >
      <td className="h-(--row-height) pl-4">
        <input
          type="checkbox"
          aria-label={`Selecionar ${rowLabel(row)}`}
          checked={checked}
          onChange={onToggle}
        />
      </td>
      <td className="tabular px-2.5 whitespace-nowrap" title={row.trade_date}>
        {formatShortDate(row.trade_date)}
      </td>
      <td className="px-2.5 whitespace-nowrap">
        <span
          className={`rounded-xs px-1.5 py-0.5 text-[0.75rem] font-medium ${KIND_PILL[row.kind]}`}
        >
          {typeLabel(row)}
        </span>
        {detail === null ? null : <span className="ml-2 text-ink-3">{detail}</span>}
      </td>
      <td className="max-w-0 min-w-32 px-2.5 font-medium">
        <span className="block truncate" title={row.asset_name ?? undefined}>
          {assetLabel(row)}
        </span>
      </td>
      {showQuantity ? (
        <td className="px-2.5 text-right whitespace-nowrap">
          {market ? <Quantity value={row.quantity} /> : <Dash />}
        </td>
      ) : null}
      {showPrice ? (
        <td className="px-2.5 text-right whitespace-nowrap">
          {market ? <Money value={row.unit_price} bare /> : <Dash />}
        </td>
      ) : null}
      {showFees ? (
        <td className="px-2.5 text-right whitespace-nowrap">
          {market && row.kind !== 'payout' ? <Money value={row.fees} bare /> : <Dash />}
        </td>
      ) : null}
      <td className="px-2.5 text-right font-medium whitespace-nowrap">
        {value.signed ? (
          <MoneyChange value={value.value} bare />
        ) : (
          <Money value={value.value} bare />
        )}
      </td>
      {showInstitution ? (
        <td className="max-w-0 min-w-24 px-2.5 text-ink-2">
          <span className="block truncate">{row.institution_name ?? '—'}</span>
        </td>
      ) : null}
      <td className={`max-w-0 min-w-40 px-2.5 ${TONE_CLASS[effect.tone]}`}>
        <span className="block truncate" title={effect.text}>
          {effect.text}
        </span>
      </td>
      <td className="px-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        <Menu
          label={`Ações de ${rowLabel(row)}`}
          items={[
            {
              id: 'edit',
              label: 'Editar',
              shortcut: 'E',
              // Perna de transferência e evento corporativo não se editam aqui.
              hint: editable ? undefined : 'Transferência e evento não são editados aqui',
              disabled: !editable,
              onSelect: onEdit,
            },
            {
              id: 'duplicate',
              label: 'Duplicar',
              shortcut: 'D',
              disabled: duplicateRequest(row) === null,
              onSelect: onDuplicate,
            },
            { id: 'move', label: 'Mover para outra carteira', onSelect: onMove },
            ...(row.asset_id === null
              ? []
              : [{ id: 'open_asset', label: 'Abrir ativo', onSelect: onOpenAsset }]),
            { id: 'delete', label: 'Excluir', destructive: true, onSelect: onDelete },
          ]}
        />
      </td>
    </tr>
  );
};

/* -------------------------------------------------------------------------- */

const Pagination = ({
  page,
  limit,
  total,
  onChange,
}: {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly onChange: (page: number) => void;
}): React.ReactElement | null => {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages === 1) return null;

  return (
    <nav
      aria-label="Páginas"
      className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[0.8125rem] text-ink-2"
    >
      <span>
        Página {page} de {pages} · {entriesLabel(total)}
      </span>
      <span className="flex gap-2">
        <Button disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Anterior
        </Button>
        <Button disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Próxima
        </Button>
      </span>
    </nav>
  );
};

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
