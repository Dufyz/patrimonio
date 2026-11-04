import { useMemo, useState } from 'react';

import { IconButton } from '../../components/primitives.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { CategoryDialog, DeleteCategoryDialog } from '../components/category_dialogs.js';
import { Amount } from '../components/amount.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { EmptyPanel } from '../components/states.js';
import { hideBelow } from '../lib/responsive.js';
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
import { categoryUsage } from '../domain/categories.js';
import { addCategory, deleteCategory, updateCategory } from '../domain/category_ops.js';
import type { Category } from '../domain/types.js';
import { categoryColor } from '../lib/category_colors.js';
import {
  isColumnVisible,
  readHiddenColumns,
  writeHiddenColumns,
} from '../lib/columns.js';
import type { ColumnSpec } from '../lib/columns.js';
import { csvAmount, exportTable } from '../lib/export.js';
import { currentMonth } from '../lib/period.js';
import { MONTH_ABBREVIATIONS, parseIso } from '../lib/dates.js';
import { EMPTY_FILTERS, passesFilters } from '../lib/filters.js';
import type { FilterField, FilterState } from '../lib/filters.js';
import { PRIMARY_LABELS, pluralize } from '../lib/header.js';
import { matchesSearch } from '../lib/text.js';
import { browserStorage } from '../../lib/preferences.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';

/**
 * FIN-101 · Categorias.
 *
 * Só a tabela: quais categorias existem e quanto cada uma pesa no mês. Contagem
 * e total são dos lançados do mês corrente; a média, dos 12 meses completos
 * anteriores. Categoria sem lançamento no mês mostra `0` e `—`.
 */

const SCREEN = 'categorias';

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

const NO_VALUE = '—';

export const CategoriesScreen = (): React.ReactElement => {
  const { today } = useFinancePeriod();
  const data = useFinanceData();
  const store = useFinanceStore();
  const { categories, entries } = data;
  const [dialog, setDialog] = useState<
    | { readonly type: 'new' }
    | { readonly type: 'edit'; readonly category: Category }
    | { readonly type: 'delete'; readonly category: Category }
    | null
  >(null);

  const monthLabel = MONTH_ABBREVIATIONS[parseIso(today).month - 1] ?? '';
  const columns: readonly ColumnSpec[] = useMemo(
    () => [
      { id: 'categoria', label: 'Categoria', locked: true },
      { id: 'tipo', label: 'Tipo' },
      { id: 'lancamentos', label: `Lançamentos em ${monthLabel}` },
      { id: 'total', label: `Total em ${monthLabel}`, locked: true },
      { id: 'media', label: 'Média de 12 meses' },
    ],
    [monthLabel],
  );

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [hidden, setHidden] = useState(() =>
    readHiddenColumns(browserStorage(), SCREEN, columns),
  );

  const rows = useMemo(
    () =>
      categories
        .filter(
          (category) =>
            matchesSearch(search, [category.name]) &&
            passesFilters(filters, () => category.kind),
        )
        .map((category) => ({
          category,
          usage: categoryUsage(entries, category.id, today),
        })),
    [categories, entries, filters, search, today],
  );

  const visible = (id: string): boolean => isColumnVisible(hidden, id);
  const colSpan = columns.filter((column) => visible(column.id)).length + 1;

  const exportCsv = (): void =>
    exportTable(
      'categorias',
      currentMonth(today),
      [
        { id: 'categoria', header: 'Categoria', value: (r) => r.category.name },
        { id: 'tipo', header: 'Tipo', value: (r) => r.category.kind },
        {
          id: 'lancamentos',
          header: `Lançamentos em ${monthLabel}`,
          value: (r) => String(r.usage.count),
        },
        {
          id: 'total',
          header: `Total em ${monthLabel}`,
          value: (r) => csvAmount(r.usage.total),
        },
        {
          id: 'media',
          header: 'Média de 12 meses',
          value: (r) => csvAmount(r.usage.average12),
        },
      ],
      hidden,
      rows,
    );

  return (
    <>
      <ScreenHeader
        title="Categorias"
        subtitle="Nome, tipo e cor de cada categoria"
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
          columns={columns}
          hiddenColumns={hidden}
          onHiddenColumns={(next) => {
            setHidden(next);
            writeHiddenColumns(browserStorage(), SCREEN, next);
          }}
          onExport={exportCsv}
        />

        <FinTable caption="Categorias">
          <THead>
            <Th>Categoria</Th>
            {visible('tipo') ? <Th>Tipo</Th> : null}
            {visible('lancamentos') ? (
              <Th align="right" className={hideBelow(2)}>
                Lançamentos em {monthLabel}
              </Th>
            ) : null}
            <Th align="right">Total em {monthLabel}</Th>
            {visible('media') ? (
              <Th align="right" className={hideBelow(1)}>
                Média de 12 meses
              </Th>
            ) : null}
            <Th>
              <span className="sr-only">Ações</span>
            </Th>
          </THead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan}>
                  <EmptyPanel
                    message="Nenhuma categoria cadastrada."
                    actionLabel="Nova categoria"
                    onAction={() => setDialog({ type: 'new' })}
                  />
                </td>
              </tr>
            ) : null}
            {SECTIONS.map((section) => {
              const group = rows.filter(({ category }) => category.kind === section.kind);
              if (group.length === 0) return null;
              return (
                <SectionGroup key={section.kind} label={section.label} colSpan={colSpan}>
                  {group.map(({ category, usage }) => (
                    <Row key={category.id}>
                      <Td>
                        <CategoryMarker
                          color={categoryColor(category.color)}
                          name={category.name}
                        />
                      </Td>
                      {visible('tipo') ? (
                        <Td className="text-xs text-ink-3">{category.kind}</Td>
                      ) : null}
                      {visible('lancamentos') ? (
                        <Td numeric className={hideBelow(2)}>
                          {usage.count}
                        </Td>
                      ) : null}
                      <Td numeric className="font-semibold">
                        {usage.count === 0 ? NO_VALUE : <Amount cents={usage.total} />}
                      </Td>
                      {visible('media') ? (
                        <Td numeric className={`text-ink-2 ${hideBelow(1)}`}>
                          {usage.average12 === 0 ? (
                            NO_VALUE
                          ) : (
                            <Amount cents={usage.average12} />
                          )}
                        </Td>
                      ) : null}
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
            store.set((current) =>
              dialog.type === 'edit'
                ? updateCategory(current, dialog.category.id, draft)
                : addCategory(current, draft),
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
            store.set((current) =>
              deleteCategory(current, dialog.category.id, replacementId),
            );
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
