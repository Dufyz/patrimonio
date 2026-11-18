import { useMemo, useState } from 'react';
import { Icon } from '../../components/icon.js';
import { Link } from 'react-router';

import { fetchCategoryUsage } from '../../api/finance_categories.js';
import { fetchFinanceCategories } from '../../api/recurrings.js';
import { Menu } from '../../components/overlay.js';
import { useShortcuts } from '../../components/shortcuts.js';
import {
  FilterBar,
  ToolbarIconButton,
  ToolbarSearch,
} from '../../components/filter_bar.js';
import { downloadCsv } from '../../finance/lib/csv.js';
import { useFinancePeriod } from '../../finance/components/period_provider.js';
import { ScreenHeader } from '../../finance/components/screen_header.js';
import { TableScreenSkeleton } from '../../finance/components/screen_skeletons.js';
import { EmptyPanel, PanelError } from '../../finance/components/states.js';
import {
  CategoryMarker,
  FinTable,
  Row,
  SectionRow,
  Td,
  Th,
  THead,
} from '../../components/table_parts.js';
import { categoryColor } from '../../finance/lib/category_colors.js';
import { financeRoutes } from '../../finance/lib/routes.js';
import {
  EMPTY_CATEGORY_FILTERS,
  filterLines,
  hasCategoryFilters,
  linesOf,
  sortLines,
} from '../../lib/category_view.js';
import type {
  CategoryFilters,
  CategoryItem,
  CategoryKind,
  CategoryLine,
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

/** CAT-06: Enter na linha abre o menu de ações dela, como o gatilho abriria. */
const openMenuOf = (label: string): void => {
  const trigger = Array.from(
    document.querySelectorAll<HTMLElement>('button[aria-label]'),
  ).find((button) => button.getAttribute('aria-label') === label);
  trigger?.focus();
  trigger?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
};

export const CategoriesScreen = (): React.ReactElement => {
  const { range } = useFinancePeriod();
  const categories = useResource((signal) => fetchFinanceCategories(signal), []);
  const usage = useResource(
    (signal) => fetchCategoryUsage({ from: range.from, to: range.to }, signal),
    [range.from, range.to],
  );

  const [filters, setFilters] = useState<CategoryFilters>(EMPTY_CATEGORY_FILTERS);
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

  const items: readonly CategoryItem[] = categories.state.value;
  const usageById = new Map(usage.state.value.rows.map((row) => [row.category_id, row]));
  const all = linesOf(items, usageById);
  const visible = sortLines(filterLines(all, filters), 'nome');
  const reload = (): void => {
    categories.reload();
    usage.reload();
  };

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader
        title="Categorias"
        subtitle="Nome e cor das categorias de despesa e receita"
        primary={{ label: 'Categoria', onClick: openNew }}
      />

      <section className="overflow-hidden rounded-panel border border-line bg-panel shadow-panel">
        <FilterBar
          search={
            <ToolbarSearch
              value={filters.q}
              label="Buscar categoria"
              placeholder="Buscar categoria"
              onChange={(q) => setFilters({ ...filters, q })}
            />
          }
          fields={[
            {
              id: 'tipo',
              label: 'Tipo',
              icon: 'tag',
              options: [
                { id: 'despesa', label: 'Despesas' },
                { id: 'receita', label: 'Receitas' },
              ],
              selected: filters.kind === '' ? [] : [filters.kind],
              onChange: (next) =>
                setFilters({
                  ...filters,
                  kind: (next.at(-1) ?? '') as CategoryFilters['kind'],
                }),
            },
          ]}
          extraCount={filters.q === '' ? 0 : 1}
          actions={
            <ToolbarIconButton
              label="Exportar"
              icon="download"
              onClick={() =>
                downloadCsv('categorias.csv', [
                  ['Categoria', 'Tipo'],
                  ...visible.map((line) => [
                    line.name,
                    line.kind === 'despesa' ? 'Despesa' : 'Receita',
                  ]),
                ])
              }
            />
          }
        />

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
            <THead>
              <Th>Categoria</Th>
              <Th>
                <span className="sr-only">Ações</span>
              </Th>
            </THead>
            {SECTIONS.map((section) => {
              const lines = visible.filter((line) => line.kind === section.kind);
              if (lines.length === 0) return null;
              return (
                <tbody key={section.kind} aria-label={section.label}>
                  <SectionRow colSpan={2} label={section.label} />
                  {lines.map((line) => (
                    <Row
                      key={line.id}
                      label={line.name}
                      onActivate={() => openMenuOf(`Ações de ${line.name}`)}
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
                      <Td align="right">
                        <Menu
                          label={`Ações de ${line.name}`}
                          items={[
                            {
                              id: 'edit',
                              label: 'Editar',
                              icon: <Icon name="pencil" />,
                              onSelect: () => setModal({ editing: line }),
                            },
                            {
                              id: 'delete',
                              label: 'Excluir',
                              icon: <Icon name="trash" />,
                              destructive: true,
                              onSelect: () => setDeleting(line),
                            },
                          ]}
                        />
                      </Td>
                    </Row>
                  ))}
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
