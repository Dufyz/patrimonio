import type { PositionResource, PositionsResource } from '@patrimonio/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { fetchPositions } from '../api/positions.js';
import { Toolbar } from '../components/controls.js';
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
import { usePreferences } from '../components/preferences.js';
import {
  Button,
  IconButton,
  Label,
  Panel,
  PriceHealthDot,
  SearchInput,
  Segmented,
} from '../components/primitives.js';
import type { TableColumn } from '../components/table.js';
import { DataTable } from '../components/table.js';
import { FilterDropdown } from '../components/filter_dropdown.js';
import { assetSlug } from '../lib/asset_page.js';
import { CSV_BOM, listFromParam, listToParam } from '../lib/statement.js';
import type { AssetNaming } from '../lib/asset_page.js';
import {
  DEFAULT_GROUP_BY,
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
  toTableGroups,
} from '../lib/positions.js';
import type { GroupByParam } from '../lib/positions.js';
import { ManualPriceDialog } from './manual_price_dialog.js';
import { Icon } from '../components/icon.js';

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

/** O que ainda não existe, e qual história o entrega. */

export type PositionsScreenProps = {
  readonly portfolioId: string;
  readonly scopeLabel: string;
  /** Abre a página do ativo (T-03), pelo apelido dele no endereço. */
  readonly onOpenAsset: (slug: string) => void;
  /** Abre Movimentações filtrada por este ativo, em todo o período. */
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

  const rawGroupBy = params.get('agrupar');
  const groupByParam = isGroupByParam(rawGroupBy) ? rawGroupBy : DEFAULT_GROUP_BY;
  const search = params.get('busca') ?? '';
  const rawCategory = params.get('classe');
  const rawInstitution = params.get('instituicao');
  const categoryIds = useMemo(() => listFromParam(rawCategory), [rawCategory]);
  const institutionIds = useMemo(() => listFromParam(rawInstitution), [rawInstitution]);

  const [draft, setDraft] = useState(search);
  const [resource, setResource] = useState<PositionsResource | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualPriceFor, setManualPriceFor] = useState<PositionResource | null>(null);
  const [reloads, setReloads] = useState(0);
  const entry = useEntry();

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
      },
      controller.signal,
    )
      .then((next) => {
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

  const groups = useMemo(
    () => (resource === null ? [] : toTableGroups(resource.groups)),
    [resource],
  );

  const total = resource === null ? null : toSummary(resource.total);
  const stamp = resource === null ? null : priceStamp(resource);
  const hasCaveat =
    resource !== null &&
    resource.price_health.fresh < resource.total.count &&
    resource.total.count > 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-screen-title leading-7 font-semibold">Posições</h1>
          <p className="text-xs text-ink-3">{scopeLabel} · posições abertas hoje</p>
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

      {resource === null ? null : (
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
          {resource.return_12m_ratio === null ? null : (
            <div className="flex items-baseline gap-2">
              <dt>rent. 12M da carteira</dt>
              <dd className="font-semibold">
                <PercentChange value={resource.return_12m_ratio} />
              </dd>
            </div>
          )}
        </dl>
      )}

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
          {/* Busca e categorias dividem o espaço que sobra e quebram entre si; o
              agrupamento fica no canto, sem quebrar junto com elas. */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-2">
            <SearchInput
              value={draft}
              label="Buscar posição"
              placeholder="Buscar ativo"
              className="w-44 shrink-0"
              onChange={setDraft}
            />

            {resource === null ? null : (
              <>
                <FilterDropdown
                  label="Categoria"
                  selected={categoryIds}
                  options={resource.facets.map((facet) => ({
                    id: facet.id,
                    label: facet.label,
                    count: facet.count,
                    colorToken: facet.color_token,
                  }))}
                  onChange={(ids) => update({ classe: listToParam(ids) })}
                />
                <FilterDropdown
                  label="Instituição"
                  selected={institutionIds}
                  options={resource.institution_facets.map((facet) => ({
                    id: facet.id,
                    label: facet.label,
                    count: facet.count,
                  }))}
                  onChange={(ids) => update({ instituicao: listToParam(ids) })}
                />
                {categoryIds.length + institutionIds.length + (search === '' ? 0 : 1) >
                0 ? (
                  <Button
                    variant="ghost"
                    aria-label="Limpar todos os filtros"
                    onClick={() =>
                      update({ classe: null, instituicao: null, busca: null })
                    }
                  >
                    Limpar
                  </Button>
                ) : null}
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Label>Agrupar</Label>
            <Segmented<GroupByParam>
              label="Agrupar por"
              value={groupByParam}
              options={groupByOptions}
              onChange={(value) =>
                update({ agrupar: value === DEFAULT_GROUP_BY ? null : value })
              }
            />
            <IconButton
              label="Exportar CSV"
              icon="export"
              disabled={resource === null || resource.groups.length === 0}
              onClick={() => resource !== null && exportCsv(resource)}
            />
          </div>
        </div>

        <div>
          {error !== null ? (
            <p className="px-4 py-6 text-sm text-negative">{error}</p>
          ) : (
            <KeepPrevious pending={pending}>
              <DataTable<PositionResource>
                screen={SCREEN}
                caption={`Posições de ${scopeLabel}`}
                columns={COLUMNS}
                groups={groups}
                rowId={positionId}
                rowLabel={positionLabel}
                {...(total === null ? {} : { total })}
                openOnClick
                onOpenRow={(row) => onOpenAsset(assetSlug(toAssetRef(row)))}
                rowActions={(row) => (
                  <RowMenu
                    position={row}
                    onManualPrice={setManualPriceFor}
                    onOpenAsset={onOpenAsset}
                    onOpenStatement={onOpenStatement}
                    onEntry={entry.openEntry}
                  />
                )}
                emptyState={
                  <EmptyState
                    filtered={
                      search !== '' || categoryIds.length > 0 || institutionIds.length > 0
                    }
                    hasClose={resource !== null && resource.as_of !== null}
                    onClear={() =>
                      update({ busca: null, classe: null, instituicao: null })
                    }
                  />
                }
              />
            </KeepPrevious>
          )}
        </div>
        <footer className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-xs text-ink-3">
          <span>
            {stamp ??
              'Carteira ainda não consolidada: a tabela aparece depois da primeira consolidação.'}
            {hasCaveat
              ? ' Nem toda linha usa preço do dia — o ponto ao lado do preço indica as exceções.'
              : ''}
          </span>
          <span>Telas estreitas escondem colunas secundárias; a linha nunca quebra.</span>
        </footer>
      </Panel>

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
const COLUMNS: readonly TableColumn<PositionResource>[] = [
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
      <span className="block min-w-0">
        <span className="block truncate font-medium" title={row.name}>
          {positionTitle(row)}
        </span>
        <span className="block truncate text-[0.75rem] text-ink-3">
          {row.institution_name ?? 'Sem instituição'}
        </span>
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
    hideBelow: 1400,
    // Na curva não há preço médio: o título vale o que a marcação diz na data,
    // e a palavra é mais honesta que um traço, que leria como ausência de dado.
    cell: (row) =>
      row.unit === 'curve' ? (
        <span className="text-ink-3">curva</span>
      ) : (
        <Money value={row.avg_price} />
      ),
  },
  {
    id: 'preco',
    header: 'Preço',
    numeric: true,
    hideBelow: 1100,
    cell: (row) => (
      <span className="whitespace-nowrap">
        <PriceHealthDot kind={row.price_health} />
        <Money value={row.price} />
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
    id: 'peso',
    header: 'Peso',
    numeric: true,
    hideBelow: 1000,
    sortable: true,
    sortValue: (row) => row.weight,
    cell: (row) => <Percent value={row.weight} decimals={1} />,
    summary: (summary) => <Percent value={summary['peso'] ?? null} decimals={1} />,
  },
  {
    id: 'resultado',
    header: 'Resultado',
    numeric: true,
    hideBelow: 1100,
    sortable: true,
    sortValue: (row) => row.open_result,
    cell: (row) => (
      <span className="flex items-baseline justify-end gap-2">
        <MoneyChange value={row.open_result} />
        <span aria-hidden="true" className="text-ink-3">
          ·
        </span>
        <PercentChange value={row.open_result_ratio} decimals={1} />
      </span>
    ),
    summary: (summary) => (
      <span className="flex items-baseline justify-end gap-2">
        <MoneyChange value={summary['resultado'] ?? null} />
        <span aria-hidden="true" className="text-ink-3">
          ·
        </span>
        <PercentChange value={summary['resultado_pct'] ?? null} decimals={1} />
      </span>
    ),
  },
];

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
  onOpenAsset,
  onOpenStatement,
  onEntry,
}: {
  readonly position: PositionResource;
  readonly onEntry: (request: OpenEntryRequest) => void;
  readonly onManualPrice: (position: PositionResource) => void;
  readonly onOpenAsset: (slug: string) => void;
  readonly onOpenStatement: ((search: string) => void) | undefined;
}): React.ReactElement => (
  <Menu
    label={`Ações de ${positionTitle(position)}`}
    items={[
      {
        id: 'buy_sell',
        label: 'Lançar compra ou venda',
        icon: <Icon name="plus" />,
        shortcut: 'L',
        onSelect: () => onEntry({ tab: 'buy', ...seedOf(position) }),
      },
      {
        id: 'payout',
        label: 'Lançar provento',
        icon: <Icon name="coin" />,
        onSelect: () => onEntry({ tab: 'payout', ...seedOf(position) }),
      },
      {
        id: 'open_asset',
        label: 'Abrir ativo',
        icon: <Icon name="tag" />,
        shortcut: '↵',
        separatorBefore: true,
        onSelect: () => onOpenAsset(assetSlug(toAssetRef(position))),
      },
      {
        id: 'manual_price',
        label: 'Definir preço manual',
        icon: <Icon name="pencil" />,
        onSelect: () => onManualPrice(position),
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
}: {
  readonly filtered: boolean;
  readonly hasClose: boolean;
  readonly onClear: () => void;
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
      <p className="text-[0.8125rem] text-ink-3">
        Um lançamento de compra abre a primeira posição.
      </p>
    )}
  </div>
);
