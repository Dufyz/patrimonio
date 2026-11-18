import { useMemo, useState } from 'react';

import { Icon } from '../../components/icon.js';
import { fetchAccounts } from '../../api/accounts.js';
import { ApiError } from '../../api/client.js';
import { fetchCardsOverview } from '../../api/cards_overview.js';
import {
  deleteRecurring,
  fetchFinanceCategories,
  fetchRecurrings,
  setRecurringActive,
  skipRecurringMonth,
} from '../../api/recurrings.js';
import { Menu, AlertModal } from '../../components/overlay.js';
import { usePortfolios } from '../../components/portfolios_provider.js';
import { usePreferences } from '../../components/preferences.js';
import { Panel } from '../../components/primitives.js';
import { useShortcuts } from '../../components/shortcuts.js';
import { FilterBar, ToolbarSearch } from '../../components/filter_bar.js';
import { Arrow } from '../ledger/ledger_parts.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { EmptyPanel, PanelError } from '../../finance/components/states.js';
import {
  FinTable,
  Row,
  SummaryRow,
  Td,
  Th,
  THead,
} from '../../components/table_parts.js';
import { categoryColor } from '../../finance/lib/category_colors.js';
import { newAttemptKey } from '../../lib/entry.js';
import { formatMoney } from '../../lib/format.js';
import { useResource } from '../../lib/use_resource.js';
import type { RecurringKind, RecurringResource } from '../../lib/recurring_view.js';
import { RecurringModal } from './recurring_modal.js';
import type { SourceOption } from './recurring_modal.js';

/**
 * REC-01 a REC-06 · Recorrentes: os modelos que geram os previstos de cada mês,
 * numa tabela só (como na v3), agrupada por tipo, categoria ou conta, com o
 * subtotal de cada grupo e o resultado mensal no pé. Aporte não é recorrente:
 * investir é uma despesa (categoria) e a compra de ativos se lança em Posições.
 */
const dm = (iso: string | null | undefined): string =>
  iso == null ? '—' : `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

type Grouping = 'tipo' | 'categoria' | 'conta';

type Filters = {
  readonly q: string;
  readonly tipo: readonly string[];
  readonly categoria: readonly string[];
  readonly conta: readonly string[];
};

const NO_FILTERS: Filters = { q: '', tipo: [], categoria: [], conta: [] };

const modelsLabel = (count: number): string =>
  `${count} ${count === 1 ? 'modelo' : 'modelos'}`;

export const RecurringsScreen = (): React.ReactElement => {
  const { hidden } = usePreferences();
  const { portfolios } = usePortfolios();
  const recurrings = useResource((signal) => fetchRecurrings(signal), []);
  const categories = useResource((signal) => fetchFinanceCategories(signal), []);
  const accounts = useResource((signal) => fetchAccounts(false, signal), []);
  const cards = useResource((signal) => fetchCardsOverview(signal), []);

  const [modal, setModal] = useState<{
    readonly editing: RecurringResource | undefined;
  } | null>(null);
  const [deleting, setDeleting] = useState<RecurringResource | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [grouping, setGrouping] = useState<Grouping>('tipo');

  const openNew = useMemo(() => () => setModal({ editing: undefined }), []);
  const shortcuts = useMemo(() => ({ new_transaction: openNew }), [openNew]);
  useShortcuts(shortcuts);

  const bare = (value: string): string => formatMoney(value, { hidden, bare: true }).text;

  const sources: readonly SourceOption[] = useMemo(
    () => [
      ...(accounts.state.kind === 'ready'
        ? accounts.state.value.accounts
            .filter((row) => !row.account.archived)
            .map((row) => ({
              id: `conta:${row.account.id}`,
              name: row.account.name,
              isCard: false,
            }))
        : []),
      ...(cards.state.kind === 'ready'
        ? cards.state.value.cards.map((row) => ({
            id: `cartao:${row.card.id}`,
            name: `${row.card.name} (cartão)`,
            isCard: true,
          }))
        : []),
    ],
    [accounts.state, cards.state],
  );

  const failed =
    recurrings.state.kind === 'error' ||
    categories.state.kind === 'error' ||
    accounts.state.kind === 'error';
  if (failed) {
    return (
      <PanelError
        title="Não foi possível carregar os recorrentes"
        onRetry={() => {
          recurrings.reload();
          categories.reload();
          accounts.reload();
          cards.reload();
        }}
      />
    );
  }
  if (
    recurrings.state.kind !== 'ready' ||
    categories.state.kind !== 'ready' ||
    accounts.state.kind !== 'ready'
  ) {
    return <TableScreenSkeleton label="Carregando recorrentes" columns={6} />;
  }

  const { recurrings: all } = recurrings.state.value;
  const catList = categories.state.value;
  const sourceName = (id: string): string =>
    sources.find((s) => s.id.endsWith(`:${id}`))?.name ?? '—';
  const categoryName = (id: string | null): string =>
    id === null ? '—' : (catList.find((c) => c.id === id)?.name ?? '—');
  const portfolioName = (id: string | null | undefined): string =>
    id == null
      ? '—'
      : (portfolios.find((p) => p.id === id)?.name ?? 'carteira arquivada');
  const archivedPortfolio = (item: RecurringResource): boolean =>
    item.kind === 'aporte' &&
    item.portfolio_id != null &&
    portfolios.length > 0 &&
    !portfolios.some((p) => p.id === item.portfolio_id);

  const refresh = (): void => recurrings.reload();
  const attempt = async (action: () => Promise<unknown>): Promise<void> => {
    setFailure(null);
    try {
      await action();
      refresh();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'Não foi possível salvar.');
    }
  };
  const month = new Date().toISOString().slice(0, 7);

  const pay = (item: RecurringResource): React.ReactNode =>
    item.second_source === null ? (
      sourceName(item.source.id)
    ) : (
      <>
        {sourceName(item.source.id)} + {sourceName(item.second_source.id)}
      </>
    );

  const actions = (item: RecurringResource): React.ReactElement => (
    <Td align="right">
      <Menu
        label={`Ações de ${item.name}`}
        items={[
          {
            id: 'edit',
            label: 'Editar',
            icon: <Icon name="pencil" />,
            onSelect: () => setModal({ editing: item }),
          },
          {
            id: 'toggle',
            label: item.active ? 'Pausar' : 'Ativar',
            icon: <Icon name={item.active ? 'pulse' : 'check'} />,
            onSelect: () =>
              void attempt(() =>
                setRecurringActive(item.id, !item.active, newAttemptKey()),
              ),
          },
          {
            id: 'skip',
            label: 'Pular este mês',
            icon: <Icon name="repeat" />,
            disabled: !item.active,
            onSelect: () =>
              void attempt(() => skipRecurringMonth(item.id, month, newAttemptKey())),
          },
          {
            id: 'delete',
            label: 'Excluir',
            icon: <Icon name="trash" />,
            destructive: true,
            onSelect: () => setDeleting(item),
          },
        ]}
      />
    </Td>
  );

  const nameCell = (item: RecurringResource, chip?: string): React.ReactElement => (
    <Td>
      <span className="font-medium">{item.name}</span>
      {chip === undefined ? null : (
        <span className="ml-2 rounded-[4px] bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
          {chip}
        </span>
      )}
      {item.active ? null : (
        <span className="ml-2 text-xs font-normal text-ink-3">pausado</span>
      )}
      {item.mode === 'manual' && item.kind !== 'aporte' ? (
        <span className="ml-2 text-xs font-normal text-ink-3">manual</span>
      ) : null}
      {archivedPortfolio(item) ? (
        <span className="block text-xs text-attention">
          carteira arquivada: não gera previsto
        </span>
      ) : null}
    </Td>
  );

  const cents = (value: string): number => {
    const [whole = '0', frac = ''] = value.split('.');
    const sign = whole.startsWith('-') ? -1 : 1;
    return sign * (Math.abs(Number(whole)) * 100 + Number(`${frac}00`.slice(0, 2)));
  };
  const fromCents = (value: number): string => (value / 100).toFixed(2);
  /** Com sinal: receita soma, despesa e aporte subtraem. Pausado fica fora da soma. */
  const signedSum = (items: readonly RecurringResource[]): number =>
    items
      .filter((item) => item.active)
      .reduce(
        (sum, item) => sum + (item.kind === 'receita' ? 1 : -1) * cents(item.amount),
        0,
      );

  const query = filters.q.trim().toLowerCase();
  const visible = all.filter(
    (item) =>
      (query === '' || item.name.toLowerCase().includes(query)) &&
      (filters.tipo.length === 0 || filters.tipo.includes(item.kind)) &&
      (filters.categoria.length === 0 ||
        (item.category_id !== null && filters.categoria.includes(item.category_id))) &&
      (filters.conta.length === 0 ||
        filters.conta.includes(`${item.source.type}:${item.source.id}`) ||
        (item.second_source !== null &&
          filters.conta.includes(`${item.second_source.type}:${item.second_source.id}`))),
  );

  type Group = {
    readonly key: string;
    readonly label: string;
    readonly items: readonly RecurringResource[];
  };
  const KIND_GROUPS: readonly { kind: RecurringKind; label: string }[] = [
    { kind: 'receita', label: 'Receitas' },
    { kind: 'despesa', label: 'Despesas' },
    { kind: 'aporte', label: 'Aportes' },
  ];
  const byDay = (items: readonly RecurringResource[]): readonly RecurringResource[] =>
    [...items].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, 'pt-BR'));
  const groups: readonly Group[] =
    grouping === 'tipo'
      ? KIND_GROUPS.map((g) => ({
          key: g.kind,
          label: g.label,
          items: byDay(visible.filter((item) => item.kind === g.kind)),
        })).filter((g) => g.items.length > 0)
      : grouping === 'categoria'
        ? [...new Set(visible.map((item) => item.category_id ?? ''))]
            .map((id) => ({
              key: id,
              label: id === '' ? 'Sem categoria' : categoryName(id),
              items: byDay(visible.filter((item) => (item.category_id ?? '') === id)),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
        : [...new Set(visible.map((item) => item.source.id))]
            .map((id) => ({
              key: id,
              label: sourceName(id),
              items: byDay(visible.filter((item) => item.source.id === id)),
            }))
            .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

  const signedCell = (value: number): React.ReactElement => (
    <Td numeric className={`font-semibold ${value > 0 ? 'text-positive' : ''}`}>
      {value > 0 ? '+' : value < 0 ? '−' : ''}
      {bare(fromCents(Math.abs(value)))}
    </Td>
  );

  const COLUMNS = 7;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Recorrentes"
        subtitle="Receitas e despesas que se repetem e geram os previstos de cada mês"
        primary={{ label: 'Recorrente', onClick: openNew }}
      />

      {failure === null ? null : (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-negative/40 bg-panel px-4 py-2 text-[0.8125rem]"
        >
          <span>{failure}</span>
          <button
            type="button"
            className="cursor-pointer underline"
            onClick={() => {
              setFailure(null);
              refresh();
            }}
          >
            Recarregar
          </button>
        </div>
      )}

      {all.length === 0 ? (
        <EmptyPanel
          message="Nenhum recorrente ainda. Cadastre o que se repete todo mês para os previstos nascerem sozinhos."
          actionLabel="Novo recorrente"
          onAction={openNew}
        />
      ) : (
        <Panel className="overflow-visible">
          <FilterBar
            search={
              <ToolbarSearch
                value={filters.q}
                label="Buscar recorrente"
                placeholder="Buscar recorrente"
                onChange={(q) => setFilters({ ...filters, q })}
              />
            }
            extraCount={filters.q === '' ? 0 : 1}
            fields={[
              {
                id: 'tipo',
                label: 'Tipo',
                icon: 'tag',
                options: KIND_GROUPS.filter((g) =>
                  all.some((item) => item.kind === g.kind),
                ).map((g) => ({ id: g.kind, label: g.label })),
                selected: filters.tipo,
                onChange: (tipo) => setFilters({ ...filters, tipo: [...tipo] }),
              },
              {
                id: 'categoria',
                label: 'Categoria',
                icon: 'hash',
                options: catList
                  .filter((c) => all.some((item) => item.category_id === c.id))
                  .map((c) => ({ id: c.id, label: c.name })),
                selected: filters.categoria,
                onChange: (categoria) =>
                  setFilters({ ...filters, categoria: [...categoria] }),
              },
              {
                id: 'conta',
                label: 'Conta ou cartão',
                icon: 'bank',
                options: sources.map((s) => ({ id: s.id, label: s.name })),
                selected: filters.conta,
                onChange: (conta) => setFilters({ ...filters, conta: [...conta] }),
              },
            ]}
            display={{
              groupBy: {
                label: 'Agrupar por',
                value: grouping,
                options: [
                  { value: 'tipo', label: 'Tipo' },
                  { value: 'categoria', label: 'Categoria' },
                  { value: 'conta', label: 'Conta ou cartão' },
                ],
                onChange: (value) => setGrouping(value as Grouping),
              },
            }}
          />
          {visible.length === 0 ? (
            <EmptyPanel
              message="Nenhum recorrente com esses filtros."
              actionLabel="Limpar filtros"
              onAction={() => setFilters(NO_FILTERS)}
            />
          ) : (
            <FinTable caption="Recorrentes">
              <THead>
                <Th>Modelo</Th>
                <Th align="right">Dia</Th>
                <Th>Conta ou cartão</Th>
                <Th className="max-md:hidden">Categoria</Th>
                <Th>Próximo previsto</Th>
                <Th align="right">Valor (R$)</Th>
                <Th>
                  <span className="sr-only">Ações</span>
                </Th>
              </THead>
              {groups.map((group) => (
                <tbody key={group.key}>
                  <tr className="border-t border-line bg-panel-2">
                    <th
                      scope="rowgroup"
                      colSpan={COLUMNS}
                      className="px-3 py-[var(--row-pad)] text-left text-[0.8125rem] font-semibold"
                    >
                      {group.label}
                      <span className="ml-2 font-normal text-ink-3">
                        {modelsLabel(group.items.length)}
                      </span>
                    </th>
                  </tr>
                  {group.items.map((item) => (
                    <Row
                      key={item.id}
                      label={item.name}
                      muted={!item.active}
                      onActivate={() => setModal({ editing: item })}
                    >
                      {nameCell(item)}
                      <Td numeric>{item.day}</Td>
                      <Td>
                        {item.kind === 'aporte' ? (
                          <>
                            {sourceName(item.source.id)}
                            <Arrow />
                            {portfolioName(item.portfolio_id)}
                          </>
                        ) : (
                          pay(item)
                        )}
                      </Td>
                      <Td className="text-ink-2 max-md:hidden">
                        {item.kind === 'aporte' ? (
                          '—'
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="inline-block size-2 rounded-[2px]"
                              style={{
                                backgroundColor: categoryColor(
                                  catList.find((c) => c.id === item.category_id)?.color,
                                ),
                              }}
                            />
                            {categoryName(item.category_id)}
                          </span>
                        )}
                      </Td>
                      <Td className="tabular text-ink-2">{dm(item.next_planned)}</Td>
                      <Td
                        numeric
                        className={`font-semibold ${item.kind === 'receita' ? 'text-positive' : ''}`}
                      >
                        {item.kind === 'receita' ? '+' : '−'}
                        {bare(item.amount)}
                      </Td>
                      {actions(item)}
                    </Row>
                  ))}
                  <SummaryRow>
                    <Td colSpan={5}>Total · {group.label}</Td>
                    {signedCell(signedSum(group.items))}
                    <Td />
                  </SummaryRow>
                </tbody>
              ))}
              <tbody>
                <SummaryRow kind="total">
                  <Td colSpan={5}>Resultado mensal (receitas − despesas)</Td>
                  {signedCell(signedSum(visible))}
                  <Td />
                </SummaryRow>
              </tbody>
            </FinTable>
          )}
        </Panel>
      )}

      {modal === null ? null : (
        <RecurringModal
          editing={modal.editing}
          categories={catList}
          portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))}
          sources={sources}
          onSaved={refresh}
          onClose={() => setModal(null)}
        />
      )}
      <AlertModal
        open={deleting !== null}
        title="Excluir recorrente?"
        message={`Os previstos pendentes de "${deleting?.name ?? ''}" saem; o que já foi lançado fica.`}
        cancelLabel="Cancelar"
        confirmLabel="Excluir"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target !== null)
            void attempt(() => deleteRecurring(target.id, newAttemptKey()));
        }}
      />
    </div>
  );
};
