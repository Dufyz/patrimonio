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
  SummaryRow,
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
  paymentParts,
  primarySourceOf,
  signedCents,
  summaryLabel,
} from '../domain/recurring_view.js';
import { sourceName } from '../domain/sources.js';
import { GroupSelector } from '../components/group_selector.js';
import {
  RECURRING_GROUPINGS,
  readRecurringGrouping,
  writeRecurringGrouping,
} from '../lib/preferences.js';
import type { RecurringGrouping } from '../lib/preferences.js';
import type { Category, FinanceData, Recurring } from '../domain/types.js';
import { allocatePercentTenths, formatPercentTenths } from '../lib/format.js';
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
import { useFinanceData, useFinanceStore } from '../store/finance_store.js';
import { commands } from '../store/commands.js';

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
  { id: 'peso', label: '% do bloco' },
  { id: 'ativo', label: 'Ativo', locked: true },
];

const SECTIONS = [
  { kind: 'receita', label: 'Receitas', total: 'Total de receitas' },
  { kind: 'despesa', label: 'Despesas', total: 'Total de despesas' },
] as const;

type Group = {
  readonly key: string;
  readonly label: string;
  readonly total: string;
  readonly items: readonly Recurring[];
};

/** Só o que está ativo entra nos totais: pausado não gera previsto. */
const activeTotal = (items: readonly Recurring[]): number =>
  items.filter((r) => r.active).reduce((sum, r) => sum + signedCents(r), 0);

/**
 * O peso de cada item ativo no bloco, em décimos de ponto (RN-64): a soma dos
 * de cada tipo fecha em 100%. Receita pesa contra receitas, despesa contra
 * despesas — num bloco misto (agrupado por conta) os dois somam 100% à parte.
 */
const weightsOf = (items: readonly Recurring[]): ReadonlyMap<string, number> => {
  const weights = new Map<string, number>();
  for (const kind of ['receita', 'despesa'] as const) {
    const active = items.filter((r) => r.kind === kind && r.active);
    const tenths = allocatePercentTenths(active.map((r) => r.cents));
    active.forEach((r, index) => weights.set(r.id, tenths[index] ?? 0));
  }
  return weights;
};

/** Monta os blocos da tabela conforme o agrupamento; dentro de cada um, pelo dia. */
const groupRecurrings = (
  grouping: RecurringGrouping,
  rows: readonly Recurring[],
  categories: readonly Category[],
  data: FinanceData,
): readonly Group[] => {
  const sorted = rows.toSorted(byDay);
  if (grouping === 'tipo') {
    return SECTIONS.map((s) => ({
      key: s.kind,
      label: s.label,
      total: s.total,
      items: sorted.filter((r) => r.kind === s.kind),
    })).filter((g) => g.items.length > 0);
  }
  if (grouping === 'categoria') {
    const ordered = [
      ...categories.filter((c) => c.kind === 'receita'),
      ...categories.filter((c) => c.kind === 'despesa'),
    ];
    return ordered
      .map((c) => ({
        key: c.id,
        label: c.name,
        total: `Total · ${c.name}`,
        items: sorted.filter((r) => r.categoryId === c.id),
      }))
      .filter((g) => g.items.length > 0);
  }
  const ids = [...new Set(sorted.map(primarySourceOf))].toSorted((a, b) =>
    sourceName(data, a).localeCompare(sourceName(data, b), 'pt-BR'),
  );
  return ids.map((id) => ({
    key: id,
    label: sourceName(data, id),
    total: `Total · ${sourceName(data, id)}`,
    items: sorted.filter((r) => primarySourceOf(r) === id),
  }));
};

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

  const [grouping, setGrouping] = useState<RecurringGrouping>(() =>
    readRecurringGrouping(browserStorage()),
  );
  const groups = useMemo(
    () => groupRecurrings(grouping, rows, categories, data),
    [grouping, rows, categories, data],
  );
  const hasBothKinds =
    rows.some((r) => r.kind === 'receita') && rows.some((r) => r.kind === 'despesa');

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
        {
          id: 'pagamento',
          header: 'Pagamento',
          value: (r) => paymentText(data, r),
        },
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
      groups.flatMap((group) => group.items),
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
          group={
            <GroupSelector
              value={grouping}
              options={RECURRING_GROUPINGS}
              onChange={(next) => {
                setGrouping(next);
                writeRecurringGrouping(browserStorage(), next);
              }}
            />
          }
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
            {visible('peso') ? (
              <Th align="right" className={hideBelow(1)}>
                % do bloco
              </Th>
            ) : null}
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
            {groups.map((group) => {
              const weights = weightsOf(group.items);
              return (
                <SectionGroup key={group.key} label={group.label} colSpan={colSpan}>
                  {group.items.map((recurring) => (
                    <RecurringRow
                      key={recurring.id}
                      recurring={recurring}
                      weight={weights.get(recurring.id)}
                      visible={visible}
                      onToggle={(active) =>
                        store.run(
                          commands.setRecurringActive(recurring.id, active, today),
                        )
                      }
                      onEdit={() => setDialog({ type: 'edit', recurring })}
                      onDelete={() => setDialog({ type: 'delete', recurring })}
                    />
                  ))}
                  <TotalRow
                    label={group.total}
                    cents={activeTotal(group.items)}
                    paused={group.items.filter((r) => !r.active).length}
                    colSpan={colSpan}
                    showWeight={visible('peso')}
                  />
                </SectionGroup>
              );
            })}
            {groups.length > 0 && hasBothKinds ? (
              <TotalRow
                grand
                label="Resultado mensal (receitas − despesas)"
                cents={activeTotal(rows)}
                paused={0}
                colSpan={colSpan}
                showWeight={visible('peso')}
              />
            ) : null}
          </tbody>
        </FinTable>
      </section>

      {dialog?.type === 'new' || dialog?.type === 'edit' ? (
        <RecurringDialog
          today={today}
          data={data}
          recurring={dialog.type === 'edit' ? dialog.recurring : undefined}
          onClose={() => setDialog(null)}
          onSave={(draft) => {
            store.run(
              dialog.type === 'edit'
                ? commands.updateRecurring(dialog.recurring.id, draft, today)
                : commands.addRecurring(draft, today),
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
            store.run(commands.deleteRecurring(dialog.recurring.id));
            setDialog(null);
          }}
        />
      ) : null}
    </>
  );
};

/** O texto de Pagamento para exportar: "Flex R$ 150,00 + Itaú R$ 850,00". */
const paymentText = (data: FinanceData, recurring: Recurring): string => {
  const parts = paymentParts(data, recurring);
  return parts.length === 1
    ? paymentLabel(data, recurring)
    : parts.map((p) => `${p.name} ${csvAmount(p.cents)}`).join(' + ');
};

/** Total do bloco (ou resultado do mês): sob a coluna Valor, só do que está ativo. */
const TotalRow = ({
  label,
  cents,
  paused,
  colSpan,
  showWeight,
  grand = false,
}: {
  readonly label: string;
  readonly cents: number;
  readonly paused: number;
  readonly colSpan: number;
  readonly showWeight: boolean;
  readonly grand?: boolean;
}): React.ReactElement => (
  <SummaryRow kind={grand ? 'total' : 'subtotal'}>
    <Td colSpan={Math.max(colSpan - (showWeight ? 4 : 3), 1)}>
      {label}
      {paused === 0 ? null : (
        <span className="ml-2 text-xs font-normal text-ink-3">
          sem {paused === 1 ? '1 pausado' : `${paused} pausados`}
        </span>
      )}
    </Td>
    <Td numeric>
      <Amount cents={cents} variant="flow" />
    </Td>
    {showWeight ? <Td className={hideBelow(1)} /> : null}
    <Td colSpan={2} />
  </SummaryRow>
);

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
  weight,
  visible,
  onToggle,
  onEdit,
  onDelete,
}: {
  readonly recurring: Recurring;
  /** Peso no bloco, em décimos de ponto; ausente para pausado. */
  readonly weight: number | undefined;
  readonly visible: (id: string) => boolean;
  readonly onToggle: (active: boolean) => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}): React.ReactElement => {
  const data = useFinanceData();
  const { categories } = data;
  const category = categoryOf(categories, recurring);
  const parts = paymentParts(data, recurring);

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
          {parts.length === 1 ? (
            parts[0]?.name
          ) : (
            <ul className="grid gap-0.5">
              {parts.map((part) => (
                <li
                  key={part.sourceId}
                  className="flex items-baseline justify-between gap-4"
                >
                  <span>{part.name}</span>
                  <span className="tabular text-xs text-ink-2">
                    <Amount cents={part.cents} />
                  </span>
                </li>
              ))}
            </ul>
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
      {visible('peso') ? (
        <Td numeric className={`text-ink-2 ${hideBelow(1)}`}>
          {weight === undefined ? '—' : formatPercentTenths(weight)}
        </Td>
      ) : null}
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
