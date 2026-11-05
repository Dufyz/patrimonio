import { useMemo, useState } from 'react';

import { useFinancePeriod } from '../components/period_provider.js';
import { currentMonth } from '../lib/period.js';

import { IconButton } from '../../components/primitives.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { CategoryDialog, DeleteCategoryDialog } from '../components/category_dialogs.js';
import { EmptyPanel } from '../components/states.js';
import { ScreenHeader } from '../components/screen_header.js';
import {
  CategoryMarker,
  FinTable,
  Row,
  SectionRow,
  Td,
  Th,
  THead,
} from '../components/fin_table.js';
import { TableToolbar } from '../components/table_toolbar.js';
import type { Category } from '../domain/types.js';
import { categoryColor } from '../lib/category_colors.js';
import { exportTable } from '../lib/export.js';
import { EMPTY_FILTERS, passesFilters } from '../lib/filters.js';
import type { FilterField, FilterState } from '../lib/filters.js';
import { PRIMARY_LABELS, pluralize } from '../lib/header.js';
import { matchesSearch } from '../lib/text.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';
import { commands } from '../store/commands.js';

/**
 * FIN-101 · Categorias.
 *
 * Tela de cadastro: só o setup (nome, cor e tipo, que já aparece na seção).
 * Análise de uso por categoria fica para as telas de análise.
 */

const FILTER_FIELDS: readonly FilterField[] = [
  {
    id: 'tipo',
    label: 'Tipo',
    options: [
      { value: 'despesa', label: 'Despesa' },
      { value: 'receita', label: 'Receita' },
    ],
  },
];

const SECTIONS = [
  { kind: 'despesa', label: 'Despesas' },
  { kind: 'receita', label: 'Receitas' },
] as const;

export const CategoriesScreen = (): React.ReactElement => {
  const { today } = useFinancePeriod();
  const data = useFinanceData();
  const store = useFinanceStore();
  const { categories } = data;
  const [dialog, setDialog] = useState<
    | { readonly type: 'new' }
    | { readonly type: 'edit'; readonly category: Category }
    | { readonly type: 'delete'; readonly category: Category }
    | null
  >(null);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

  const rows = useMemo(
    () =>
      categories.filter(
        (category) =>
          matchesSearch(search, [category.name]) &&
          passesFilters(filters, () => category.kind),
      ),
    [categories, filters, search],
  );

  const exportCsv = (): void =>
    exportTable(
      'categorias',
      currentMonth(today),
      [
        { id: 'categoria', header: 'Categoria', value: (c) => c.name },
        { id: 'tipo', header: 'Tipo', value: (c) => c.kind },
      ],
      [],
      rows,
    );

  return (
    <>
      <ScreenHeader
        title="Categorias"
        subtitle="Nome e cor das categorias de despesa e receita"
        primary={{
          label: PRIMARY_LABELS.categories,
          onClick: () => setDialog({ type: 'new' }),
        }}
      />

      <section className="rounded-panel border border-line bg-panel">
        <TableToolbar
          counter={pluralize(rows.length, 'categoria', 'categorias')}
          searchPlaceholder="Buscar categoria"
          search={search}
          onSearch={setSearch}
          filterFields={FILTER_FIELDS}
          filters={filters}
          onFilters={setFilters}
          onExport={exportCsv}
        />

        <FinTable caption="Categorias">
          <THead>
            <Th>Categoria</Th>
            <Th>
              <span className="sr-only">Ações</span>
            </Th>
          </THead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2}>
                  <EmptyPanel
                    message="Nenhuma categoria cadastrada."
                    actionLabel="Nova categoria"
                    onAction={() => setDialog({ type: 'new' })}
                  />
                </td>
              </tr>
            ) : null}
            {SECTIONS.map((section) => {
              const group = rows.filter((category) => category.kind === section.kind);
              if (group.length === 0) return null;
              return (
                <SectionGroup key={section.kind} label={section.label} colSpan={2}>
                  {group.map((category) => (
                    <Row key={category.id}>
                      <Td>
                        <CategoryMarker
                          color={categoryColor(category.color)}
                          name={category.name}
                        />
                      </Td>
                      <Td align="right" className="w-12">
                        <RowMenu
                          category={category}
                          onEdit={() => setDialog({ type: 'edit', category })}
                          onDelete={() => setDialog({ type: 'delete', category })}
                        />
                      </Td>
                    </Row>
                  ))}
                </SectionGroup>
              );
            })}
          </tbody>
        </FinTable>
      </section>

      {dialog?.type === 'new' || dialog?.type === 'edit' ? (
        <CategoryDialog
          data={data}
          category={dialog.type === 'edit' ? dialog.category : undefined}
          onClose={() => setDialog(null)}
          onSave={(draft) => {
            store.run(
              dialog.type === 'edit'
                ? commands.updateCategory(dialog.category.id, draft)
                : commands.addCategory(draft),
            );
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.type === 'delete' ? (
        <DeleteCategoryDialog
          data={data}
          category={dialog.category}
          onClose={() => setDialog(null)}
          onConfirm={(replacementId) => {
            store.run(commands.deleteCategory(dialog.category.id, replacementId));
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );
};

const SectionGroup = ({
  label,
  colSpan,
  children,
}: {
  readonly label: string;
  readonly colSpan: number;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <>
    <SectionRow colSpan={colSpan} label={label} />
    {children}
  </>
);

/** O `⋯` da linha: editar e excluir. */
const RowMenu = ({
  category,
  onEdit,
  onDelete,
}: {
  readonly category: Category;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}): React.ReactElement => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <IconButton row label={`Ações de ${category.name}`} icon="dots" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-40">
      <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
      <DropdownMenuItem destructive onSelect={onDelete}>
        Excluir
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
