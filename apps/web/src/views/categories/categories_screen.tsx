import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { fetchCategoryUsage } from '../../api/finance_categories.js';
import { fetchFinanceCategories } from '../../api/recurrings.js';
import { Menu } from '../../components/overlay.js';
import { usePreferences } from '../../components/preferences.js';
import { useShortcuts } from '../../components/shortcuts.js';
import { FlowPeriodControl } from '../../components/period_control.js';
import { useFinancePeriod } from '../../finance/components/period_provider.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { EmptyPanel, PanelError } from '../../finance/components/states.js';
import {
  CategoryMarker,
  FinTable,
  Row,
  SectionRow,
  SummaryRow,
  Td,
  Th,
} from '../../finance/components/fin_table.js';
import { categoryColor } from '../../finance/lib/category_colors.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import { formatMoney } from '../../lib/format.js';
import {
  EMPTY_CATEGORY_FILTERS,
  filterLines,
  hasCategoryFilters,
  isEmptyPeriod,
  linesOf,
  sectionTotal,
  sortLines,
} from '../../lib/category_view.js';
import type {
  CategoryFilters,
  CategoryItem,
  CategoryKind,
  CategoryLine,
  CategorySort,
  Nature,
} from '../../lib/category_view.js';
import { useResource } from '../../lib/use_resource.js';
import { CategoryModal, DeleteCategoryModal } from './category_modals.js';

/**
 * CAT-01/02/03 · Categorias com o uso do período: Lançado e Previsto por
 * categoria, totais por seção e cadastro. Tudo vem do servidor; o total de
 * Despesas lançado é o mesmo da Visão geral e de Lançamentos (RN-U16). Aportes
 * não são categoria.
 */
const SECTIONS: readonly { kind: CategoryKind; label: string }[] = [
  { kind: 'despesa', label: 'Despesas' },
  { kind: 'receita', label: 'Receitas' },
];

const NATURE_LABEL: Readonly<Record<Nature, string>> = { fixa: 'Fixa', livre: 'Livre' };

const control =
  'h-control cursor-pointer rounded-control border border-line-2 bg-panel px-2 text-[0.8125rem]';

export const CategoriesScreen = (): React.ReactElement => {
  const { hidden } = usePreferences();
  const { range, setRange, today } = useFinancePeriod();
  const categories = useResource((signal) => fetchFinanceCategories(signal), []);
  const usage = useResource(
    (signal) => fetchCategoryUsage({ from: range.from, to: range.to }, signal),
    [range.from, range.to],
  );

  const [filters, setFilters] = useState<CategoryFilters>(EMPTY_CATEGORY_FILTERS);
  const [sort, setSort] = useState<CategorySort>('nome');
  const [modal, setModal] = useState<{
    readonly editing: CategoryLine | undefined;
  } | null>(null);
  const [deleting, setDeleting] = useState<CategoryLine | null>(null);

  const openNew = useMemo(() => () => setModal({ editing: undefined }), []);
  const shortcuts = useMemo(() => ({ new_transaction: openNew }), [openNew]);
  useShortcuts(shortcuts);

  if (categories.state.kind === 'error' || usage.state.kind === 'error') {
    return (
      <PanelError
        title="Não foi possível carregar as categorias"
        onRetry={() => {
          categories.reload();
          usage.reload();
        }}
      />
    );
  }
  if (categories.state.kind !== 'ready' || usage.state.kind !== 'ready') {
    return <TableScreenSkeleton label="Carregando categorias" columns={5} />;
  }

  const money = (value: string): string => formatMoney(value, { hidden }).text;
  const items: readonly CategoryItem[] = categories.state.value;
  const usageById = new Map(usage.state.value.rows.map((row) => [row.category_id, row]));
  const all = linesOf(items, usageById);
  const visible = sortLines(filterLines(all, filters), sort);
  const reload = (): void => {
    categories.reload();
    usage.reload();
  };

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Categorias"
        subtitle="Receitas e despesas por categoria no período"
        period={<FlowPeriodControl value={range} onChange={setRange} today={today} />}
        primary={{ label: 'Nova categoria', onClick: openNew }}
      />

      <section className="overflow-hidden rounded-panel border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="mr-2 text-[0.8125rem] text-ink-2">
            {visible.length} {visible.length === 1 ? 'categoria' : 'categorias'}
          </span>
          <input
            type="search"
            aria-label="Buscar categoria"
            placeholder="Buscar categoria"
            className={`${control} w-48 cursor-text`}
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          />
          <select
            aria-label="Tipo"
            className={control}
            value={filters.kind}
            onChange={(e) =>
              setFilters({ ...filters, kind: e.target.value as CategoryFilters['kind'] })
            }
          >
            <option value="">Todos os tipos</option>
            <option value="despesa">Despesas</option>
            <option value="receita">Receitas</option>
          </select>
          <select
            aria-label="Natureza"
            className={control}
            value={filters.nature}
            onChange={(e) =>
              setFilters({
                ...filters,
                nature: e.target.value as CategoryFilters['nature'],
              })
            }
          >
            <option value="">Fixas e livres</option>
            <option value="fixa">Fixas</option>
            <option value="livre">Livres</option>
          </select>
          <label className="ml-auto flex items-center gap-2 text-[0.8125rem] text-ink-3">
            Ordenar
            <select
              aria-label="Ordenar por"
              className={control}
              value={sort}
              onChange={(e) => setSort(e.target.value as CategorySort)}
            >
              <option value="nome">Nome</option>
              <option value="lancado">Lançado</option>
              <option value="previsto">Previsto</option>
            </select>
          </label>
        </div>

        {all.length === 0 ? (
          <EmptyPanel
            message="Nenhuma categoria ainda."
            actionLabel="Nova categoria"
            onAction={openNew}
          />
        ) : visible.length === 0 ? (
          <EmptyPanel
            message="Nenhuma categoria com esses filtros."
            {...(hasCategoryFilters(filters)
              ? {
                  actionLabel: 'Limpar filtros',
                  onAction: () => setFilters(EMPTY_CATEGORY_FILTERS),
                }
              : {})}
          />
        ) : (
          <FinTable caption="Categorias">
            {SECTIONS.map((section) => {
              const lines = visible.filter((line) => line.kind === section.kind);
              if (lines.length === 0) return null;
              const withNature = section.kind === 'despesa';
              const cols = withNature ? 5 : 4;
              return (
                <tbody key={section.kind} aria-label={section.label}>
                  <SectionRow colSpan={cols} label={section.label} />
                  <tr className="border-b border-line">
                    <Th>Categoria</Th>
                    {withNature ? <Th className="max-md:hidden">Natureza</Th> : null}
                    <Th align="right">Lançado</Th>
                    <Th align="right" className="max-lg:hidden">
                      Previsto
                    </Th>
                    <Th>
                      <span className="sr-only">Ações</span>
                    </Th>
                  </tr>
                  {lines.map((line) => (
                    <Row
                      key={line.id}
                      label={line.name}
                      onActivate={() => setModal({ editing: line })}
                    >
                      <Td>
                        <Link
                          to={financeRoutes.entries(
                            `categoria=${line.id}&tipo=${line.kind.toUpperCase()}`,
                          )}
                          className="cursor-pointer hover:underline"
                        >
                          <CategoryMarker
                            color={categoryColor(line.color)}
                            name={line.name}
                          />
                        </Link>
                      </Td>
                      {withNature ? (
                        <Td className="max-md:hidden">
                          {line.nature == null ? '—' : NATURE_LABEL[line.nature]}
                        </Td>
                      ) : null}
                      <Td numeric>
                        {isEmptyPeriod(line.posted) ? '0' : money(line.posted)}
                      </Td>
                      <Td numeric className="max-lg:hidden">
                        {isEmptyPeriod(line.planned) ? '—' : money(line.planned)}
                      </Td>
                      <Td align="right">
                        <Menu
                          label={`Ações de ${line.name}`}
                          items={[
                            {
                              id: 'edit',
                              label: 'Editar',
                              onSelect: () => setModal({ editing: line }),
                            },
                            {
                              id: 'delete',
                              label: 'Excluir',
                              destructive: true,
                              onSelect: () => setDeleting(line),
                            },
                          ]}
                        />
                      </Td>
                    </Row>
                  ))}
                  <SummaryRow>
                    <Td colSpan={withNature ? 2 : 1}>Total · {section.label}</Td>
                    <Td numeric>{money(sectionTotal(lines, 'posted'))}</Td>
                    <Td numeric>{money(sectionTotal(lines, 'planned'))}</Td>
                    <Td />
                  </SummaryRow>
                </tbody>
              );
            })}
          </FinTable>
        )}
      </section>

      {modal === null ? null : (
        <CategoryModal
          editing={modal.editing}
          entriesTotal={modal.editing?.entriesTotal ?? 0}
          existing={items}
          onSaved={reload}
          onClose={() => setModal(null)}
        />
      )}
      {deleting === null ? null : (
        <DeleteCategoryModal
          category={deleting}
          candidates={items.filter((c) => c.kind === deleting.kind)}
          onDeleted={reload}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
};
