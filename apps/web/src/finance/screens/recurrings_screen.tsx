import { useMemo, useState } from 'react';

import { IconButton } from '../../components/primitives.js';
import { Switch } from '../../components/ui/switch.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { browserStorage } from '../../lib/preferences.js';
import {
  DeleteRecurringDialog,
  RecurringDialog,
} from '../components/recurring_dialogs.js';
import { useFinancePeriod } from '../components/period_provider.js';
import { Amount } from '../components/amount.js';
import {
  CategoryMarker,
  FinTable,
  Row,
  SectionRow,
  Td,
  Th,
  THead,
} from '../components/fin_table.js';
import { EmptyPanel } from '../components/states.js';
import { hideBelow } from '../lib/responsive.js';
import { ScreenHeader } from '../components/screen_header.js';
import { TableToolbar } from '../components/table_toolbar.js';
import {
  MODE_LABEL,
  byDay,
  categoryOf,
  paymentLabel,
  paymentNote,
  summaryLabel,
} from '../domain/recurring_view.js';
import type { Recurring } from '../domain/types.js';
import { categoryColor } from '../lib/category_colors.js';
import {
  isColumnVisible,
  readHiddenColumns,
  writeHiddenColumns,
} from '../lib/columns.js';
import type { ColumnSpec } from '../lib/columns.js';
import { csvAmount, exportTable } from '../lib/export.js';
import { currentMonth } from '../lib/period.js';
import { EMPTY_FILTERS, passesFilters } from '../lib/filters.js';
import type { FilterField, FilterState } from '../lib/filters.js';
import { PRIMARY_LABELS } from '../lib/header.js';
import { matchesSearch } from '../lib/text.js';
import {
  addRecurring,
  deleteRecurring,
  setRecurringActive,
  updateRecurring,
} from '../domain/recurring.js';
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';

/**
 * FIN-201 · Recorrentes.
 *
 * Só a tabela: o que se repete todo mês e gera os previstos de Lançamentos no
 * dia 1. Receitas primeiro, depois despesas; dentro de cada seção, pelo dia do
 * mês. Valor de modo manual é estimativa e diz isso. Linha pausada fica esmaecida.
 */

const SCREEN = 'recorrentes';

const COLUMNS: readonly ColumnSpec[] = [
  { id: 'item', label: 'Item', locked: true },
  { id: 'categoria', label: 'Categoria' },
  { id: 'pagamento', label: 'Pagamento' },
  { id: 'dia', label: 'Dia' },
  { id: 'lancamento', label: 'Lançamento' },
  { id: 'valor', label: 'Valor', locked: true },
  { id: 'ativo', label: 'Ativo', locked: true },
];

const SECTIONS = [
  { kind: 'receita', label: 'Receitas' },
  { kind: 'despesa', label: 'Despesas' },
] as const;

export const RecurringsScreen = (): React.ReactElement => {
  const data = useFinanceData();
  const { categories, recurrings } = data;
  const store = useFinanceStore();
  const { today } = useFinancePeriod();
  const [dialog, setDialog] = useState<
    | { readonly type: 'new' }
    | { readonly type: 'edit'; readonly recurring: Recurring }
    | { readonly type: 'delete'; readonly recurring: Recurring }
    | null
  >(null);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [hidden, setHidden] = useState(() =>
    readHiddenColumns(browserStorage(), SCREEN, COLUMNS),
  );

  const filterFields: readonly FilterField[] = useMemo(
    () => [
      {
        id: 'tipo',
        label: 'Tipo',
        options: [
          { value: 'receita', label: 'Receita' },
          { value: 'despesa', label: 'Despesa' },
        ],
      },
      {
        id: 'categoria',
        label: 'Categoria',
        options: categories.map((c) => ({ value: c.id, label: c.name })),
      },
      {
        id: 'lancamento',
        label: 'Lançamento',
        options: [
          { value: 'automatico', label: 'Automático' },
          { value: 'manual', label: 'Manual' },
        ],
      },
      {
        id: 'situacao',
        label: 'Situação',
        options: [
          { value: 'ativo', label: 'Ativo' },
          { value: 'pausado', label: 'Pausado' },
        ],
      },
    ],
    [categories],
  );

  const rows = useMemo(
    () =>
      recurrings.filter(
        (recurring) =>
          matchesSearch(search, [
            recurring.name,
            categoryOf(categories, recurring)?.name ?? '',
            paymentLabel(data, recurring),
          ]) &&
          passesFilters(filters, (field) => {
            switch (field) {
              case 'tipo':
                return recurring.kind;
              case 'categoria':
                return recurring.categoryId;
              case 'lancamento':
                return recurring.mode;
              default:
                return recurring.active ? 'ativo' : 'pausado';
            }
          }),
      ),
    [categories, filters, recurrings, search],
  );

  const visible = (id: string): boolean => isColumnVisible(hidden, id);
  const colSpan = COLUMNS.filter((column) => visible(column.id)).length + 1;

  const exportCsv = (): void =>
    exportTable(
      'recorrentes',
      currentMonth(today),
      [
        { id: 'item', header: 'Item', value: (r) => r.name },
        {
          id: 'categoria',
          header: 'Categoria',
          value: (r) => categoryOf(categories, r)?.name ?? '',
        },
        { id: 'pagamento', header: 'Pagamento', value: (r) => paymentLabel(data, r) },
        { id: 'dia', header: 'Dia', value: (r) => String(r.day) },
        { id: 'lancamento', header: 'Lançamento', value: (r) => MODE_LABEL[r.mode] },
        {
          id: 'valor',
          header: 'Valor',
          value: (r) => csvAmount(r.kind === 'receita' ? r.cents : -r.cents),
        },
        { id: 'ativo', header: 'Ativo', value: (r) => (r.active ? 'sim' : 'não') },
      ],
      hidden,
      SECTIONS.flatMap((section) =>
        rows.filter((r) => r.kind === section.kind).toSorted(byDay),
      ),
    );

  return (
    <>
      <ScreenHeader
        title="Recorrentes"
        subtitle="Receitas e despesas que se repetem e geram os previstos de Lançamentos todo dia 1"
        primary={{
          label: PRIMARY_LABELS.recurrings,
          onClick: () => setDialog({ type: 'new' }),
        }}
      />

      <section className="rounded-panel border border-line bg-panel">
        <TableToolbar
          counter={summaryLabel(rows)}
          counterIcon="repeat"
          searchPlaceholder="Buscar recorrente"
          search={search}
          onSearch={setSearch}
          filterFields={filterFields}
          filters={filters}
          onFilters={setFilters}
          columns={COLUMNS}
          hiddenColumns={hidden}
          onHiddenColumns={(next) => {
            setHidden(next);
            writeHiddenColumns(browserStorage(), SCREEN, next);
          }}
          onExport={exportCsv}
        />

        <FinTable caption="Recorrentes">
          <THead>
            <Th>Item</Th>
            {visible('categoria') ? <Th>Categoria</Th> : null}
            {visible('pagamento') ? <Th className={hideBelow(2)}>Pagamento</Th> : null}
            {visible('dia') ? (
              <Th align="right" className={hideBelow(3)}>
                Dia
              </Th>
            ) : null}
            {visible('lancamento') ? <Th className={hideBelow(1)}>Lançamento</Th> : null}
            <Th align="right">Valor</Th>
            <Th align="center">Ativo</Th>
            <Th>
              <span className="sr-only">Ações</span>
            </Th>
          </THead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan}>
                  {data.recurrings.length === 0 ? (
                    <EmptyPanel
                      message="Nenhum recorrente cadastrado."
                      actionLabel="Novo recorrente"
                      onAction={() => setDialog({ type: 'new' })}
                    />
                  ) : (
                    <EmptyPanel message="Nenhum recorrente com esses filtros." />
                  )}
                </td>
              </tr>
            ) : null}
            {SECTIONS.map((section) => {
              const group = rows
                .filter((recurring) => recurring.kind === section.kind)
                .toSorted(byDay);
              if (group.length === 0) return null;
              return (
                <SectionGroup key={section.kind} label={section.label} colSpan={colSpan}>
                  {group.map((recurring) => (
                    <RecurringRow
                      key={recurring.id}
                      recurring={recurring}
                      visible={visible}
                      onToggle={(active) =>
                        store.set((current) =>
                          setRecurringActive(current, recurring.id, active, today),
                        )
                      }
                      onEdit={() => setDialog({ type: 'edit', recurring })}
                      onDelete={() => setDialog({ type: 'delete', recurring })}
                    />
                  ))}
                </SectionGroup>
              );
            })}
          </tbody>
        </FinTable>
      </section>

      {dialog?.type === 'new' || dialog?.type === 'edit' ? (
        <RecurringDialog
          data={data}
          recurring={dialog.type === 'edit' ? dialog.recurring : undefined}
          onClose={() => setDialog(null)}
          onSave={(draft) => {
            store.set((current) =>
              dialog.type === 'edit'
                ? updateRecurring(current, dialog.recurring.id, draft, today)
                : addRecurring(current, draft, today),
            );
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.type === 'delete' ? (
        <DeleteRecurringDialog
          recurring={dialog.recurring}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            store.set((current) => deleteRecurring(current, dialog.recurring.id));
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

const RecurringRow = ({
  recurring,
  visible,
  onToggle,
  onEdit,
  onDelete,
}: {
  readonly recurring: Recurring;
  readonly visible: (id: string) => boolean;
  readonly onToggle: (active: boolean) => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}): React.ReactElement => {
  const data = useFinanceData();
  const { categories } = data;
  const category = categoryOf(categories, recurring);
  const note = paymentNote(data, recurring);

  return (
    <Row muted={!recurring.active}>
      <Td className="font-medium">{recurring.name}</Td>
      {visible('categoria') ? (
        <Td>
          {category === undefined ? (
            '—'
          ) : (
            <CategoryMarker color={categoryColor(category.color)} name={category.name} />
          )}
        </Td>
      ) : null}
      {visible('pagamento') ? (
        <Td className={hideBelow(2)}>
          <span className={note === null ? undefined : 'font-semibold'}>
            {paymentLabel(data, recurring)}
          </span>
          {note === null ? null : (
            <span className="block text-xs text-ink-3">{note}</span>
          )}
        </Td>
      ) : null}
      {visible('dia') ? (
        <Td numeric className={hideBelow(3)}>
          {String(recurring.day).padStart(2, '0')}
        </Td>
      ) : null}
      {visible('lancamento') ? (
        <Td className={`text-xs text-ink-3 ${hideBelow(1)}`}>
          {MODE_LABEL[recurring.mode]}
        </Td>
      ) : null}
      <Td numeric>
        <Amount
          cents={recurring.kind === 'receita' ? recurring.cents : -recurring.cents}
          variant="flow"
          className="font-semibold"
        />
        {recurring.mode === 'manual' ? (
          <span className="block text-xs font-normal text-ink-3">estimativa</span>
        ) : null}
      </Td>
      <Td align="center">
        <Switch
          checked={recurring.active}
          onCheckedChange={onToggle}
          aria-label={`Ativo: ${recurring.name}`}
        />
      </Td>
      <Td align="right" className="w-12">
        <RowMenu recurring={recurring} onEdit={onEdit} onDelete={onDelete} />
      </Td>
    </Row>
  );
};

/** O `⋯` da linha: editar e excluir. */
const RowMenu = ({
  recurring,
  onEdit,
  onDelete,
}: {
  readonly recurring: Recurring;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}): React.ReactElement => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <IconButton row label={`Ações de ${recurring.name}`} icon="dots" />
    </DropdownMenuTrigger>
    <DropdownMenuContent className="min-w-40">
      <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
      <DropdownMenuItem destructive onSelect={onDelete}>
        Excluir
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
