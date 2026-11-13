import { useMemo, useState } from 'react';

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
import { Segmented } from '../../components/primitives.js';
import { useShortcuts } from '../../components/shortcuts.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { EmptyPanel, PanelError } from '../../finance/components/states.js';
import {
  FinTable,
  Row,
  SectionRow,
  SummaryRow,
  Td,
  Th,
  THead,
} from '../../finance/components/fin_table.js';
import { categoryColor } from '../../finance/lib/category_colors.js';
import {
  RECURRING_GROUPINGS,
  readRecurringGrouping,
  writeRecurringGrouping,
} from '../../finance/lib/preferences.js';
import type { RecurringGrouping } from '../../finance/lib/preferences.js';
import { newAttemptKey } from '../../lib/entry.js';
import { formatMoney } from '../../lib/format.js';
import { useResource } from '../../lib/use_resource.js';
import { browserStorage } from '../../lib/preferences.js';
import {
  EMPTY_RECURRING_FILTERS,
  filterRecurrings,
  groupRecurrings,
  hasRecurringFilters,
  monthlyResult,
  summaryLabel,
} from '../../lib/recurring_view.js';
import type {
  RecurringFilters,
  RecurringKind,
  RecurringResource,
} from '../../lib/recurring_view.js';
import { RecurringModal } from './recurring_modal.js';
import type { SourceOption } from './recurring_modal.js';

/**
 * REC-01 a REC-06 · Recorrentes: o que gera previstos todo mês. Blocos por tipo
 * (receitas, despesas, aportes), % do bloco e resultado mensal = receitas −
 * despesas − aportes. Tudo lido e gravado no servidor; a tela não calcula
 * previsto, só mostra o modelo.
 */
const GROUP_LABEL: Readonly<Record<RecurringGrouping, string>> = {
  tipo: 'Tipo',
  categoria: 'Categoria',
  conta: 'Conta',
};

const KIND_OPTIONS: readonly { value: RecurringKind | ''; label: string }[] = [
  { value: '', label: 'Todos os tipos' },
  { value: 'receita', label: 'Receitas' },
  { value: 'despesa', label: 'Despesas' },
  { value: 'aporte', label: 'Aportes' },
];

const control =
  'h-control cursor-pointer rounded-control border border-line-2 bg-panel px-2 text-[0.8125rem]';

const tenthsText = (tenths: number | undefined): string =>
  tenths === undefined ? '—' : `${(tenths / 10).toFixed(1).replace('.', ',')}%`;

export const RecurringsScreen = (): React.ReactElement => {
  const { hidden } = usePreferences();
  const { portfolios } = usePortfolios();
  const recurrings = useResource((signal) => fetchRecurrings(signal), []);
  const categories = useResource((signal) => fetchFinanceCategories(signal), []);
  const accounts = useResource((signal) => fetchAccounts(false, signal), []);
  const cards = useResource((signal) => fetchCardsOverview(signal), []);

  const [filters, setFilters] = useState<RecurringFilters>(EMPTY_RECURRING_FILTERS);
  const [grouping, setGrouping] = useState<RecurringGrouping>(() =>
    readRecurringGrouping(browserStorage()),
  );
  const [modal, setModal] = useState<{
    readonly editing: RecurringResource | undefined;
  } | null>(null);
  const [deleting, setDeleting] = useState<RecurringResource | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const openNew = useMemo(() => () => setModal({ editing: undefined }), []);
  const shortcuts = useMemo(() => ({ new_transaction: openNew }), [openNew]);
  useShortcuts(shortcuts);

  const money = (value: string): string => formatMoney(value, { hidden }).text;

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
    return <TableScreenSkeleton label="Carregando recorrentes" columns={8} />;
  }

  const all = recurrings.state.value;
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

  const visible = filterRecurrings(all, filters);
  const groups = groupRecurrings(visible, grouping, {
    category: categoryName,
    source: sourceName,
  });

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
  const COLS = 9;

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Recorrentes"
        subtitle="Receitas, despesas e aportes que se repetem e geram previstos"
        primary={{ label: 'Novo recorrente', onClick: openNew }}
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

      <section className="overflow-hidden rounded-panel border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="mr-2 text-[0.8125rem] text-ink-2">{summaryLabel(all)}</span>
          <input
            type="search"
            aria-label="Buscar recorrente"
            placeholder="Buscar recorrente"
            className={`${control} w-48 cursor-text`}
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
          <select
            aria-label="Tipo"
            className={control}
            value={filters.kinds[0] ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                kinds: e.target.value === '' ? [] : [e.target.value as RecurringKind],
              })
            }
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Categoria"
            className={control}
            value={filters.categories[0] ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                categories: e.target.value === '' ? [] : [e.target.value],
              })
            }
          >
            <option value="">Todas as categorias</option>
            {catList
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <select
            aria-label="Conta ou cartão"
            className={control}
            value={filters.sources[0] ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                sources:
                  e.target.value === '' ? [] : [e.target.value.split(':')[1] ?? ''],
              })
            }
          >
            <option value="">Todas as contas e cartões</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Situação"
            className={control}
            value={filters.situation[0] ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                situation:
                  e.target.value === '' ? [] : [e.target.value as 'ativo' | 'pausado'],
              })
            }
          >
            <option value="">Ativos e pausados</option>
            <option value="ativo">Ativos</option>
            <option value="pausado">Pausados</option>
          </select>
          <select
            aria-label="Lançamento"
            className={control}
            value={filters.modes[0] ?? ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                modes:
                  e.target.value === ''
                    ? []
                    : [e.target.value as 'manual' | 'automatico'],
              })
            }
          >
            <option value="">Automático e manual</option>
            <option value="automatico">Automático</option>
            <option value="manual">Manual</option>
          </select>
          <span className="ml-auto flex items-center gap-2 text-[0.8125rem] text-ink-3">
            Agrupar
            <Segmented
              label="Agrupar por"
              value={grouping}
              options={RECURRING_GROUPINGS.map((value) => ({
                value,
                label: GROUP_LABEL[value],
              }))}
              onChange={(next) => {
                setGrouping(next);
                writeRecurringGrouping(browserStorage(), next);
              }}
            />
          </span>
        </div>

        {all.length === 0 ? (
          <EmptyPanel
            message="Nenhum recorrente ainda. Cadastre o que se repete todo mês para os previstos nascerem sozinhos."
            actionLabel="Novo recorrente"
            onAction={openNew}
          />
        ) : visible.length === 0 ? (
          <EmptyPanel
            message="Nenhum recorrente com esses filtros."
            {...(hasRecurringFilters(filters)
              ? {
                  actionLabel: 'Limpar filtros',
                  onAction: () => setFilters(EMPTY_RECURRING_FILTERS),
                }
              : {})}
          />
        ) : (
          <FinTable caption="Recorrentes">
            <THead>
              <Th>Item</Th>
              <Th>Categoria</Th>
              <Th className="max-[1000px]:hidden">Pagamento</Th>
              <Th align="right" className="max-[900px]:hidden">
                Dia
              </Th>
              <Th className="max-[1100px]:hidden">Lançamento</Th>
              <Th align="right">Valor</Th>
              <Th align="right" className="max-[800px]:hidden">
                % do bloco
              </Th>
              <Th align="center">Ativo</Th>
              <Th>
                <span className="sr-only">Ações</span>
              </Th>
            </THead>
            <tbody>
              {groups.map((group) => (
                <GroupBlock
                  key={group.key}
                  label={group.label}
                  colSpan={COLS}
                  total={money(group.total)}
                >
                  {group.items.map((item) => {
                    const edit = (): void => setModal({ editing: item });
                    const toggle = (): void =>
                      void attempt(() =>
                        setRecurringActive(item.id, !item.active, newAttemptKey()),
                      );
                    const warnPortfolio = archivedPortfolio(item);
                    return (
                      <Row
                        key={item.id}
                        label={item.name}
                        muted={!item.active}
                        onActivate={edit}
                        onToggle={toggle}
                      >
                        <Td>
                          <span className="font-medium">{item.name}</span>
                          {warnPortfolio ? (
                            <span className="block text-xs text-attention">
                              carteira arquivada: não gera previsto
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          {item.kind === 'aporte' ? (
                            <span className="flex flex-col">
                              <span>{portfolioName(item.portfolio_id)}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="inline-block size-2.5 rounded-[2px]"
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
                        <Td className="max-[1000px]:hidden">
                          {item.second_source === null ? (
                            sourceName(item.source.id)
                          ) : (
                            <span className="flex flex-col text-xs">
                              <span>
                                {sourceName(item.source.id)}{' '}
                                {money(item.covers_up_to ?? '0.00')}
                              </span>
                              <span>
                                {sourceName(item.second_source.id)}{' '}
                                {money(
                                  (
                                    Number(item.amount) - Number(item.covers_up_to ?? 0)
                                  ).toFixed(2),
                                )}
                              </span>
                            </span>
                          )}
                        </Td>
                        <Td numeric className="max-[900px]:hidden">
                          {item.day}
                        </Td>
                        <Td className="max-[1100px]:hidden">
                          {item.mode === 'automatico' ? 'Automático' : 'Manual'}
                        </Td>
                        <Td numeric>
                          {money(item.amount)}
                          {item.mode === 'manual' ? (
                            <span className="block text-xs font-normal text-ink-3">
                              estimativa
                            </span>
                          ) : null}
                        </Td>
                        <Td numeric className="max-[800px]:hidden">
                          {item.active ? tenthsText(group.weights.get(item.id)) : '—'}
                        </Td>
                        <Td align="center">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={item.active}
                            aria-label={`Ativo: ${item.name}`}
                            className={`relative h-5 w-9 cursor-pointer rounded-full border border-line-2 transition-colors ${
                              item.active ? 'bg-accent' : 'bg-panel-2'
                            }`}
                            onClick={toggle}
                          >
                            <span
                              aria-hidden="true"
                              className={`absolute top-0.5 size-3.5 rounded-full bg-panel shadow transition-all ${
                                item.active ? 'left-[1.1rem]' : 'left-0.5'
                              }`}
                            />
                          </button>
                        </Td>
                        <Td align="right">
                          <Menu
                            label={`Ações de ${item.name}`}
                            items={[
                              { id: 'edit', label: 'Editar', onSelect: edit },
                              {
                                id: 'skip',
                                label: 'Pular este mês',
                                disabled: !item.active,
                                onSelect: () =>
                                  void attempt(() =>
                                    skipRecurringMonth(item.id, month, newAttemptKey()),
                                  ),
                              },
                              {
                                id: 'delete',
                                label: 'Excluir',
                                destructive: true,
                                onSelect: () => setDeleting(item),
                              },
                            ]}
                          />
                        </Td>
                      </Row>
                    );
                  })}
                </GroupBlock>
              ))}
              <SummaryRow kind="total">
                <Td colSpan={5}>Resultado mensal (receitas − despesas − aportes)</Td>
                <Td numeric>{money(monthlyResult(visible))}</Td>
                <Td colSpan={3} />
              </SummaryRow>
            </tbody>
          </FinTable>
        )}
      </section>

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

const GroupBlock = ({
  label,
  total,
  colSpan,
  children,
}: {
  readonly label: string;
  readonly total: string;
  readonly colSpan: number;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <>
    <SectionRow colSpan={colSpan} label={label} />
    {children}
    <SummaryRow>
      <Td colSpan={5}>Total ativo · {label}</Td>
      <Td numeric>{total}</Td>
      <Td colSpan={3} />
    </SummaryRow>
  </>
);
