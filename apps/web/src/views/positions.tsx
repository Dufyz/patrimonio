import type {
  ClosedPosition,
  PositionResource,
  PositionsResource,
} from '@patrimonio/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchClosedPositions, fetchPositions } from '../api/positions.js';
import { Toolbar } from '../components/controls.js';
import type { DisplayColumn, FilterField } from '../components/filter_bar.js';
import { FilterBar, ToolbarIconButton, ToolbarSearch } from '../components/filter_bar.js';
import { useShortcuts } from '../components/shortcuts.js';
import {
  Money,
  MoneyChange,
  Percent,
  PercentChange,
  Quantity,
} from '../components/number.js';
import { Menu } from '../components/overlay.js';
import { useEntry } from '../components/entry_provider.js';
import type { OpenEntryRequest } from '../components/entry_provider.js';
import { KeepPrevious } from '../components/pending.js';
import { SkeletonRegion, SkeletonStats, SkeletonTable } from '../components/skeleton.js';
import { usePreferences } from '../components/preferences.js';
import { Button, IconButton, Panel, PriceHealthDot } from '../components/primitives.js';
import type { TableColumn } from '../components/table.js';
import { DataTable } from '../components/table.js';
import { assetSlug } from '../lib/asset_page.js';
import { CSV_BOM, listFromParam, listToParam } from '../lib/statement.js';
import type { AssetNaming } from '../lib/asset_page.js';
import { readGrouping, writeGrouping } from '../lib/view_preferences.js';
import type { GroupByParam } from '../lib/positions.js';
import {
  DEFAULT_GROUP_BY,
  GROUP_BY_PARAMS,
  effectiveGroupBy,
  groupByOptions,
  isGroupByParam,
  positionId,
  positionLabel,
  positionsCsv,
  positionsCsvFilename,
  positionTitle,
  positionsCountLabel,
  priceStamp,
  toGroupBy,
  toSummary,
  closedAsRow,
  toTableGroups,
  withClosedRows,
} from '../lib/positions.js';
import type { PositionRow } from '../lib/positions.js';
import { ManualPriceDialog } from './manual_price_dialog.js';
import { CustodyTransferDialog } from './custody_transfer_dialog.js';
import { Icon } from '../components/icon.js';
import type { ColumnPreference } from '../lib/table/columns.js';
import { EMPTY_COLUMN_PREFERENCE, toggleColumn } from '../lib/table/columns.js';
import type { Sort } from '../lib/table/model.js';

/**
 * T-02 · Posições.
 *
 * A tabela de tudo que está em carteira hoje. A tela responde uma pergunta — o
 * que eu tenho — e tudo nela existe para responder mais depressa: o
 * agrupamento é escolha de quem olha, o estado do preço aparece sem clique, e a
 * linha leva direto à página do ativo — o detalhe vive lá, e não numa gaveta
 * que repete metade dela.
 *
 * Nenhum número desta tela é calculado aqui. Subtotal, total, peso, resultado e
 * contagem chegam prontos da `api`; o que acontece neste arquivo é escolher
 * onde cada um aparece. É o que mantém o subtotal do grupo correto quando
 * "mostrar mais" esconde nove das catorze linhas.
 */

const SCREEN = 'posicoes';

/** "2026-11-11" → "11/11/2026". */
const consolidationDate = (iso: string): string =>
  `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** O tipo e a instituição vêm ocultos: a linha do ativo é de uma linha só. */
const DEFAULT_COLUMN_PREFERENCE: ColumnPreference = {
  ...EMPTY_COLUMN_PREFERENCE,
  hidden: [],
};

/** O que ainda não existe, e qual história o entrega. */

export type PositionsScreenProps = {
  /** Nulo é o escopo de todas as carteiras. */
  readonly portfolioId: string | null;
  readonly scopeLabel: string;
  /**
   * Abre a página do ativo (T-03), pelo apelido dele no endereço. A carteira é a
   * da linha: em Todas as carteiras a mesma ação abre o papel na carteira certa.
   */
  readonly onOpenAsset: (slug: string, portfolioId: string | null) => void;
  /** Abre Lançamentos filtrado por este ativo. */
  readonly onOpenStatement?: ((search: string) => void) | undefined;
};

export const PositionsScreen = ({
  portfolioId,
  scopeLabel,
  onOpenAsset,
  onOpenStatement,
}: PositionsScreenProps): React.ReactElement => {
  const [params, setParams] = useSearchParams();
  const { hidden: valuesHidden, toggleHidden } = usePreferences();

  const allPortfolios = portfolioId === null;
  const rawGroupBy = params.get('agrupar');
  // CMP-13: sem `?agrupar=` na URL, vale o último agrupamento escolhido neste aparelho.
  const [remembered, setRemembered] = useState<GroupByParam>(() =>
    readGrouping<GroupByParam>('posicoes', GROUP_BY_PARAMS, DEFAULT_GROUP_BY),
  );
  const groupByParam = effectiveGroupBy(
    isGroupByParam(rawGroupBy) ? rawGroupBy : remembered,
    allPortfolios,
  );
  const search = params.get('busca') ?? '';
  const rawCategory = params.get('classe');
  const rawInstitution = params.get('instituicao');
  const rawSituation = params.get('situacao');
  const situations = useMemo(() => listFromParam(rawSituation), [rawSituation]);
  const withoutQuote = situations.includes('sem_cotacao');
  const wantsClosed = situations.includes('encerrada');
  // Encerrada sozinha esconde as abertas; sem filtro de situação, as encerradas ficam de fora.
  const onlyClosed = wantsClosed && situations.length === 1;
  const categoryIds = useMemo(() => listFromParam(rawCategory), [rawCategory]);
  const institutionIds = useMemo(() => listFromParam(rawInstitution), [rawInstitution]);

  const [draft, setDraft] = useState(search);
  const [resource, setResource] = useState<PositionsResource | null>(null);
  const [closed, setClosed] = useState<readonly ClosedPosition[]>([]);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualPriceFor, setManualPriceFor] = useState<PositionResource | null>(null);
  const [transferFor, setTransferFor] = useState<PositionResource | null>(null);
  const [reloads, setReloads] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnPreference, setColumnPreference] = useState<ColumnPreference>(
    DEFAULT_COLUMN_PREFERENCE,
  );
  const [sort, setSort] = useState<Sort | null>(null);
  const entry = useEntry();

  // `F` abre a lista de campos, como o botão Filtrar promete. `N` lança já na
  // carteira do escopo (POS-07.2); em Todas, a carteira se escolhe no modal.
  const openEntry = entry.openEntry;
  const shortcuts = useMemo(
    () => ({
      filter: () => setFilterOpen(true),
      new_transaction: () => openEntry({ tab: 'buy', portfolioId }),
    }),
    [openEntry, portfolioId],
  );
  useShortcuts(shortcuts);

  // O padrão nunca é escrito na URL: `/posicoes` é o recorte sem filtro, e não
  // `/posicoes?agrupar=categoria&busca=&classe=`.
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

  // Digitar não é filtrar: a busca só vai para a URL quando a digitação para,
  // e vai substituindo a entrada do histórico — senão voltar uma página
  // apagaria uma letra.
  useEffect(() => {
    if (draft === search) return;
    const timer = setTimeout(() => update({ busca: draft }, true), 250);
    return () => clearTimeout(timer);
  }, [draft, search, update]);

  useEffect(() => setDraft(search), [search]);

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);

    fetchPositions(
      {
        portfolioId,
        groupBy: toGroupBy(groupByParam),
        search,
        categoryIds,
        institutionIds,
        withoutQuote,
      },
      controller.signal,
    )
      .then(async (next) => {
        // As encerradas acompanham a tabela; se a consulta delas falha, a tabela
        // aberta continua valendo — não são o assunto da tela.
        const history = await fetchClosedPositions(
          portfolioId,
          search,
          controller.signal,
        ).catch(() => null);
        if (controller.signal.aborted) return;

        setClosed(history === null ? [] : history.positions);
        setResource(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'A api não respondeu');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });

    return () => controller.abort();
  }, [
    portfolioId,
    groupByParam,
    search,
    categoryIds,
    institutionIds,
    withoutQuote,
    reloads,
    entry.version,
  ]);

  const exportCsv = (data: PositionsResource): void => {
    const blob = new Blob([CSV_BOM, positionsCsv(data.groups)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = positionsCsvFilename(data.as_of ?? 'hoje');
    link.click();
    URL.revokeObjectURL(url);
  };

  const groups = useMemo(() => {
    if (resource === null) return [];

    // Instituição não é conhecida nas encerradas: com esse filtro ativo elas
    // saem, e com filtro de classe ficam só as das classes escolhidas.
    const wanted = new Set(
      resource.facets
        .filter((facet) => categoryIds.includes(facet.id))
        .map((facet) => facet.label),
    );
    const visible =
      !wantsClosed || withoutQuote || institutionIds.length > 0
        ? []
        : closed.filter(
            (item) =>
              categoryIds.length === 0 || wanted.has(item.class_name ?? 'Sem categoria'),
          );

    return withClosedRows(
      onlyClosed ? [] : toTableGroups(resource.groups),
      visible.map((item) => closedAsRow(item, portfolioId)),
      resource.group_by,
    );
  }, [
    resource,
    closed,
    categoryIds,
    institutionIds,
    portfolioId,
    wantsClosed,
    withoutQuote,
    onlyClosed,
  ]);

  const unconsolidated = resource?.status === 'sem_consolidacao';
  const total =
    resource === null || onlyClosed || unconsolidated ? null : toSummary(resource.total);
  const stamp = resource === null ? null : priceStamp(resource);
  const hasCaveat =
    resource !== null &&
    resource.price_health.fresh < resource.total.count &&
    resource.total.count > 0;

  const tableColumns = columnsFor(
    allPortfolios && groupByParam !== 'carteira',
    resource?.as_of ?? null,
  );

  const filterFields = useMemo<readonly FilterField[]>(
    () =>
      resource === null
        ? []
        : [
            {
              id: 'classe',
              label: 'Classe',
              icon: 'tag',
              options: resource.facets.map((facet) => ({
                id: facet.id,
                label: facet.label,
                count: facet.count,
                colorToken: facet.color_token,
              })),
              selected: categoryIds,
              onChange: (ids) => update({ classe: listToParam(ids) }),
            },
            {
              id: 'instituicao',
              label: 'Instituição',
              icon: 'bank',
              options: resource.institution_facets.map((facet) => ({
                id: facet.id,
                label: facet.label,
                count: facet.count,
              })),
              selected: institutionIds,
              onChange: (ids) => update({ instituicao: listToParam(ids) }),
            },
            {
              id: 'situacao',
              label: 'Situação',
              icon: 'tag',
              options: [
                { id: 'aberta', label: 'Aberta' },
                { id: 'encerrada', label: 'Encerrada' },
                { id: 'sem_cotacao', label: 'Sem cotação do dia' },
              ],
              selected: situations,
              onChange: (ids) => update({ situacao: listToParam(ids) }),
            },
          ],
    [resource, categoryIds, institutionIds, situations, update],
  );

  const sortOptions = tableColumns
    .filter((column) => column.sortable === true)
    .flatMap((column) => [
      { value: `${column.id}:desc`, label: `${column.header} ↓` },
      { value: `${column.id}:asc`, label: `${column.header} ↑` },
    ]);

  const displayColumns: readonly DisplayColumn[] = tableColumns.map((column) => ({
    id: column.id,
    label: column.header,
    locked: column.essential === true,
    hidden: columnPreference.hidden.includes(column.id),
  }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-screen-title leading-7 font-semibold">Posições</h1>
          <p className="text-xs text-ink-3">
            {scopeLabel} ·{' '}
            {resource?.as_of == null
              ? 'carteira ainda não consolidada'
              : `consolidação de ${consolidationDate(resource.as_of)}`}
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
            onClick={() => entry.openEntry({ tab: 'buy', portfolioId })}
          >
            Lançamento
          </Button>
        </Toolbar>
      </header>

      {resource === null ? (
        error === null ? (
          <SkeletonRegion label="Carregando os totais">
            <SkeletonStats count={4} />
          </SkeletonRegion>
        ) : null
      ) : (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[0.8125rem] text-ink-2">
          <div className="flex items-baseline gap-2">
            <dt>{positionsCountLabel(resource.total)}</dt>
            <dd className="font-semibold text-ink">
              <Money value={resource.total.value} />
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt>resultado aberto</dt>
            <dd className="flex items-baseline gap-1.5 font-semibold">
              <MoneyChange value={resource.total.open_result} />
              <span aria-hidden="true" className="text-ink-3">
                ·
              </span>
              <PercentChange value={resource.total.open_result_ratio} decimals={1} />
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt>proventos 12M</dt>
            <dd className="font-semibold text-ink">
              <Money value={resource.payouts_12m} />
            </dd>
          </div>
        </dl>
      )}
      {unconsolidated ? (
        <p
          role="status"
          className="rounded-control border border-line bg-panel-2 px-3 py-2 text-[0.8125rem] text-ink-2"
        >
          Sem consolidação: nenhuma carteira deste recorte fechou até hoje. Os valores
          aparecem como — e não como zero.
        </p>
      ) : null}

      {
        <Panel>
          <FilterBar
            open={filterOpen}
            onOpenChange={setFilterOpen}
            search={
              <ToolbarSearch
                value={draft}
                label="Buscar posição"
                placeholder="Buscar ativo"
                onChange={setDraft}
              />
            }
            fields={filterFields}
            extraCount={search === '' ? 0 : 1}
            display={{
              groupBy: {
                label: 'Agrupar por',
                value: groupByParam,
                options: groupByOptions(allPortfolios),
                onChange: (value) => {
                  // O escolhido vira o padrão deste aparelho, e a URL fica limpa.
                  writeGrouping('posicoes', value);
                  if (isGroupByParam(value)) setRemembered(value);
                  update({ agrupar: value === DEFAULT_GROUP_BY ? null : value });
                },
              },
              sortBy: {
                label: 'Ordenar por',
                value: sort === null ? '' : `${sort.columnId}:${sort.direction}`,
                options: [{ value: '', label: 'Padrão' }, ...sortOptions],
                onChange: (value) => {
                  const [columnId = '', direction = 'desc'] = value.split(':');
                  setSort(
                    columnId === ''
                      ? null
                      : { columnId, direction: direction === 'asc' ? 'asc' : 'desc' },
                  );
                },
              },
              columns: displayColumns,
              onToggleColumn: (id) =>
                setColumnPreference((current) => toggleColumn(current, id)),
            }}
            actions={
              <ToolbarIconButton
                label="Exportar CSV"
                icon="export"
                disabled={resource === null || resource.groups.length === 0}
                onClick={() => resource !== null && exportCsv(resource)}
              />
            }
          />

          <div>
            {error !== null ? (
              <p className="px-4 py-6 text-sm text-negative">{error}</p>
            ) : resource === null ? (
              <SkeletonRegion label="Carregando as posições">
                <SkeletonTable rows={9} columns={7} />
              </SkeletonRegion>
            ) : (
              <KeepPrevious pending={pending}>
                <DataTable<PositionRow>
                  screen={SCREEN}
                  caption={`Posições de ${scopeLabel}`}
                  columns={tableColumns}
                  groups={groups}
                  rowId={positionId}
                  rowLabel={positionLabel}
                  isRowDisabled={(row) => row.closed === true}
                  groupAction={(group) =>
                    groupByParam === 'categoria' && group.key !== ''
                      ? {
                          label: 'Filtrar',
                          onSelect: () => update({ classe: listToParam([group.key]) }),
                        }
                      : null
                  }
                  columnPreference={columnPreference}
                  sort={sort}
                  onSortChange={setSort}
                  {...(total === null ? {} : { total })}
                  openOnClick
                  onOpenRow={(row) =>
                    onOpenAsset(assetSlug(toAssetRef(row)), row.portfolio_id)
                  }
                  rowActions={(row) => (
                    <RowMenu
                      position={row}
                      onManualPrice={setManualPriceFor}
                      onTransferCustody={setTransferFor}
                      onOpenAsset={onOpenAsset}
                      onOpenStatement={onOpenStatement}
                      onEntry={entry.openEntry}
                    />
                  )}
                  emptyState={
                    <EmptyState
                      filtered={
                        search !== '' ||
                        categoryIds.length > 0 ||
                        institutionIds.length > 0
                      }
                      hasClose={resource !== null && resource.as_of !== null}
                      onLaunch={() => entry.openEntry({ tab: 'buy', portfolioId })}
                      onClear={() =>
                        update({ busca: null, classe: null, instituicao: null })
                      }
                    />
                  }
                />
              </KeepPrevious>
            )}
          </div>
          <footer className="border-t border-line px-4 py-3 text-xs text-ink-3">
            {stamp ??
              'Carteira ainda não consolidada: a tabela aparece depois da primeira consolidação.'}
            {hasCaveat
              ? ' Nem toda linha usa preço do dia — o ponto ao lado do preço indica as exceções.'
              : ''}
          </footer>
        </Panel>
      }

      {transferFor === null ? null : (
        <CustodyTransferDialog
          target={{
            portfolio_id: transferFor.portfolio_id,
            asset_id: transferFor.asset_id,
            ticker: transferFor.ticker,
            name: transferFor.name,
            institution_id: transferFor.institution_id,
            institution_name: transferFor.institution_name,
          }}
          onClose={() => setTransferFor(null)}
          onSaved={() => {
            setTransferFor(null);
            setReloads((count) => count + 1);
          }}
        />
      )}

      <ManualPriceDialog
        position={manualPriceFor}
        defaultDate={resource?.as_of ?? null}
        onClose={() => setManualPriceFor(null)}
        onSaved={() => {
          setManualPriceFor(null);
          setReloads((count) => count + 1);
        }}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */

/**
 * As colunas, na ordem da prancha 05. A etapa em que cada uma some vem da
 * prancha 18: em vez de rolar na horizontal, a tabela larga a coluna menos
 * essencial primeiro, e `Ativo` e `Valor` nunca saem — uma tabela de posições
 * sem valor não é uma tabela de posições.
 */
const BASE_COLUMNS: readonly TableColumn<PositionRow>[] = [
  {
    id: 'ativo',
    header: 'Ativo',
    essential: true,
    flexible: true,
    sortable: true,
    // Ordena pelo que está escrito, não pelo código que a linha esconde:
    // ordenar "Tesouro IPCA+ 2035" por `IPCA2035` é ordenação invisível.
    sortValue: (row) => positionTitle(row),
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-2 font-semibold" title={row.name}>
        <span className="truncate">{positionTitle(row)}</span>
        {row.closed === true ? null : (
          <span className="shrink-0">
            <PriceHealthDot kind={row.price_health} priceDate={row.price_date} />
          </span>
        )}
        {row.closed === true ? (
          <span className="shrink-0 rounded-sm bg-accent-soft px-1.5 py-px text-[0.6875rem] font-medium text-accent">
            Fechado
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: 'classe',
    header: 'Classe',
    hideBelow: 1100,
    sortable: true,
    sortValue: (row) => row.category_name ?? '',
    cell: (row) => (
      <span className="block truncate text-ink-2">{row.category_name ?? '—'}</span>
    ),
  },
  {
    id: 'instituicao',
    header: 'Instituição',
    hideBelow: 1400,
    sortable: true,
    sortValue: (row) => row.institution_name ?? '',
    cell: (row) => (
      <span className="block truncate text-ink-2">
        {row.closed === true ? '—' : (row.institution_name ?? 'Sem instituição')}
      </span>
    ),
  },
  {
    id: 'quantidade',
    header: 'Qtd',
    numeric: true,
    hideBelow: 1000,
    sortable: true,
    sortValue: (row) => row.quantity,
    cell: (row) => <Quantity value={row.quantity} />,
  },
  {
    id: 'preco_medio',
    header: 'Preço médio',
    numeric: true,
    hideBelow: 1200,
    // Na curva não há preço médio: o título vale o que a marcação diz na data,
    // e a palavra é mais honesta que um traço, que leria como ausência de dado.
    cell: (row) =>
      row.unit === 'curve' ? (
        <span className="text-ink-3">curva</span>
      ) : (
        <Money value={row.avg_price} bare />
      ),
  },
  {
    id: 'preco',
    header: 'Preço',
    numeric: true,
    hideBelow: 1100,
    // Na curva não há preço de mercado nem ponto de saúde: só o traço.
    cell: (row) =>
      row.unit === 'curve' || row.price === null ? (
        <span className="text-ink-3">—</span>
      ) : (
        <span className="whitespace-nowrap">
          <Money value={row.price} bare />
        </span>
      ),
  },
  {
    id: 'valor',
    header: 'Valor',
    numeric: true,
    essential: true,
    sortable: true,
    sortValue: (row) => row.value,
    cell: (row) => <Money value={row.value} />,
    summary: (summary) => <Money value={summary['valor'] ?? null} />,
  },
  {
    id: 'investido',
    header: 'Investido',
    numeric: true,
    hideBelow: 1100,
    sortable: true,
    sortValue: (row) => row.cost_basis,
    cell: (row) => <Money value={row.cost_basis} />,
    summary: (summary) => <Money value={summary['custo'] ?? null} />,
  },
  {
    id: 'peso',
    header: 'Peso',
    numeric: true,
    hideBelow: 1000,
    sortable: true,
    sortValue: (row) => row.weight,
    cell: (row) => (
      <span className="flex items-center justify-end gap-2">
        <span
          aria-hidden="true"
          className="h-1.5 w-12 overflow-hidden rounded-full bg-panel-2 max-lg:hidden"
        >
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.min(100, Math.max(0, Number(row.weight ?? 0)))}%` }}
          />
        </span>
        <Percent value={row.weight} decimals={1} />
      </span>
    ),
    summary: (summary) => <Percent value={summary['peso'] ?? null} decimals={1} />,
  },
  {
    id: 'resultado',
    header: 'Resultado (R$)',
    numeric: true,
    essential: true,
    sortable: true,
    sortValue: (row) => row.open_result,
    cell: (row) => <MoneyChange value={row.open_result} />,
    summary: (summary) => <MoneyChange value={summary['resultado'] ?? null} />,
  },
  {
    id: 'resultado_pct',
    header: 'Resultado (%)',
    numeric: true,
    hideBelow: 1000,
    sortable: true,
    sortValue: (row) => row.open_result_ratio,
    cell: (row) => <PercentChange value={row.open_result_ratio} decimals={1} />,
    summary: (summary) => (
      <PercentChange value={summary['resultado_pct'] ?? null} decimals={1} />
    ),
  },
];

const CLOSED_VISIBLE = new Set(['valor', 'investido', 'resultado', 'resultado_pct']);

/** Em Todas as carteiras, a coluna que diz de qual carteira é cada linha. */
const PORTFOLIO_COLUMN: TableColumn<PositionRow> = {
  id: 'carteira',
  header: 'Carteira',
  hideBelow: 1300,
  sortable: true,
  sortValue: (row) => row.portfolio_name,
  cell: (row) =>
    row.closed === true ? (
      <span className="text-ink-3">—</span>
    ) : (
      <span className="block truncate" title={row.portfolio_name}>
        {row.portfolio_name}
      </span>
    ),
};

/** Encerrada mostra investido, vendido e resultado; o resto é traço. */
const CLOSED_COLUMNS: readonly TableColumn<PositionRow>[] = BASE_COLUMNS.map((column) =>
  column.id === 'ativo' || CLOSED_VISIBLE.has(column.id)
    ? column
    : {
        ...column,
        cell: (row: PositionRow) =>
          row.closed === true ? <span className="text-ink-3">—</span> : column.cell(row),
      },
);

const WITH_PORTFOLIO: readonly TableColumn<PositionRow>[] = [
  CLOSED_COLUMNS[0] as TableColumn<PositionRow>,
  PORTFOLIO_COLUMN,
  ...CLOSED_COLUMNS.slice(1),
];

const columnsFor = (
  withPortfolio: boolean,
  consolidatedAt: string | null,
): readonly TableColumn<PositionRow>[] =>
  (withPortfolio ? WITH_PORTFOLIO : CLOSED_COLUMNS).map((column) =>
    column.id === 'valor' && consolidatedAt !== null && column.summary !== undefined
      ? {
          ...column,
          summary: (summary) => (
            <span title={`Consolidação de ${consolidationDate(consolidatedAt)}`}>
              {column.summary?.(summary)}
            </span>
          ),
        }
      : column,
  );

/* -------------------------------------------------------------------------- */

/** O ativo e a carteira da linha: o modal abre já nesse papel, e não em branco. */
const seedOf = (position: PositionResource): OpenEntryRequest => ({
  asset: {
    id: position.asset_id,
    label: positionTitle(position),
    name: position.name,
    held: position.quantity,
  },
  portfolioId: position.portfolio_id,
});

const RowMenu = ({
  position,
  onManualPrice,
  onTransferCustody,
  onOpenAsset,
  onOpenStatement,
  onEntry,
}: {
  readonly position: PositionResource;
  readonly onEntry: (request: OpenEntryRequest) => void;
  readonly onManualPrice: (position: PositionResource) => void;
  readonly onTransferCustody: (position: PositionResource) => void;
  readonly onOpenAsset: (slug: string, portfolioId: string | null) => void;
  readonly onOpenStatement: ((search: string) => void) | undefined;
}): React.ReactElement => (
  <Menu
    label={`Ações de ${positionTitle(position)}`}
    items={[
      {
        id: 'buy',
        label: 'Lançar aporte',
        icon: <Icon name="plus" />,
        shortcut: 'L',
        onSelect: () => onEntry({ tab: 'buy', ...seedOf(position) }),
      },
      {
        id: 'sell',
        label: 'Lançar resgate',
        icon: <Icon name="swap" />,
        onSelect: () => onEntry({ tab: 'sell', ...seedOf(position) }),
      },
      {
        id: 'payout',
        label: 'Lançar provento',
        icon: <Icon name="coin" />,
        onSelect: () => onEntry({ tab: 'payout', ...seedOf(position) }),
      },
      {
        id: 'event',
        label: 'Lançar evento',
        icon: <Icon name="tag" />,
        onSelect: () => onEntry({ tab: 'event', ...seedOf(position) }),
      },
      {
        id: 'open_asset',
        label: 'Abrir ativo',
        icon: <Icon name="tag" />,
        shortcut: '↵',
        separatorBefore: true,
        onSelect: () =>
          onOpenAsset(assetSlug(toAssetRef(position)), position.portfolio_id),
      },
      {
        id: 'manual_price',
        label: 'Definir preço',
        icon: <Icon name="pencil" />,
        onSelect: () => onManualPrice(position),
      },
      {
        id: 'transfer_custody',
        label: 'Transferir custódia',
        icon: <Icon name="swap" />,
        onSelect: () => onTransferCustody(position),
      },
      {
        id: 'transactions',
        label: 'Ver lançamentos',
        icon: <Icon name="swap" />,
        disabled: onOpenStatement === undefined,
        onSelect: () => onOpenStatement?.(positionTitle(position)),
      },
    ]}
  />
);

/**
 * O apelido do ativo no endereço sai das mesmas três colunas em Posições e na
 * página dele. A conversão existe porque as duas telas leem recursos
 * diferentes do mesmo papel, e a regra de qual nome ele usa é uma só.
 */
const toAssetRef = (position: PositionResource): AssetNaming => ({
  asset_id: position.asset_id,
  ticker: position.ticker,
  name: position.name,
  b3_type: position.b3_type,
});

/**
 * O-08 · "Nada encontrado" e "nada cadastrado" são estados diferentes, e dizer
 * a frase errada manda a pessoa procurar o problema no lugar errado.
 */
const EmptyState = ({
  filtered,
  hasClose,
  onClear,
  onLaunch,
}: {
  readonly filtered: boolean;
  readonly hasClose: boolean;
  readonly onClear: () => void;
  readonly onLaunch: () => void;
}): React.ReactElement => (
  <div className="flex flex-col items-start gap-2 px-3 py-10">
    <p className="text-sm">
      {filtered
        ? 'Nenhuma posição corresponde ao filtro.'
        : hasClose
          ? 'Esta carteira não tem posição aberta hoje.'
          : 'Carteira ainda não consolidada: a primeira tabela aparece depois da primeira consolidação.'}
    </p>
    {filtered ? (
      <Button onClick={onClear}>Limpar filtros</Button>
    ) : (
      <>
        <p className="text-[0.8125rem] text-ink-3">
          Um lançamento de compra abre a primeira posição.
        </p>
        <Button variant="primary" onClick={onLaunch}>
          Lançar aporte
        </Button>
      </>
    )}
  </div>
);
