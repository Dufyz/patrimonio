import { useState } from 'react';

import { Button, IconButton } from '../../components/primitives.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { Select } from '../../views/entry/fields.js';
import { Amount } from './amount.js';
import { CategoryMarker, FinTable, Row, SectionRow, Td, Th, THead } from './fin_table.js';
import { NatureTag } from './tags.js';
import { accountNames } from '../domain/ledger.js';
import { sourceName } from '../domain/sources.js';
import type { GroupSummary, LedgerGroup } from '../domain/ledger_groups.js';
import type { Category, Entry } from '../domain/types.js';
import { categoryColor } from '../lib/category_colors.js';
import { formatBRL, formatDayHeader } from '../lib/format.js';
import { pluralize } from '../lib/header.js';
import { formatDate } from '../lib/period.js';

/**
 * FIN-302 · A tabela de lançamentos.
 *
 * Colunas: Data, Descrição, Categoria, Conta, Detalhe e Valor, mais a ação da
 * linha. Receitas em verde com `+`, despesas com `−`. O previsto fica na seção
 * de cima, com o botão "Lançar".
 */

const DATA_COLUMNS = [
  'data',
  'descricao',
  'categoria',
  'conta',
  'detalhe',
  'valor',
] as const;

/** `despesas R$ 4.500,00` ou `receitas … · despesas …`. */
export const summaryText = (summary: GroupSummary): string =>
  [
    summary.receitas === undefined ? null : `receitas ${formatBRL(summary.receitas)}`,
    summary.despesas === undefined ? null : `despesas ${formatBRL(summary.despesas)}`,
    summary.previsto === undefined ? null : `previsto ${formatBRL(summary.previsto)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

/** O que a linha pode fazer: o menu `⋯` e a categoria inline (FIN-308). */
export type RowActions = {
  readonly onEdit: (entry: Entry) => void;
  readonly onMove: (entry: Entry) => void;
  readonly onDelete: (entry: Entry) => void;
  readonly onCategory: (entry: Entry, categoryId: string) => void;
};

export const LedgerTable = ({
  groups,
  categories,
  today,
  hiddenColumns = [],
  onLaunch,
  actions,
}: {
  readonly groups: readonly LedgerGroup[];
  readonly categories: readonly Category[];
  readonly today: string;
  /** Colunas ocultas pelo botão Exibição. */
  readonly hiddenColumns?: readonly string[];
  readonly onLaunch?: ((entry: Entry) => void) | undefined;
  readonly actions?: RowActions | undefined;
}): React.ReactElement => {
  const visible = (id: string): boolean => !hiddenColumns.includes(id);
  const layout: Layout = {
    visible,
    colSpan: DATA_COLUMNS.filter(visible).length + 1,
  };
  return (
    <section className="border-t border-line">
      <FinTable caption="Lançamentos">
        <THead>
          {visible('data') ? <Th>Data</Th> : null}
          <Th>Descrição</Th>
          {visible('categoria') ? <Th>Categoria</Th> : null}
          {visible('conta') ? <Th>Conta</Th> : null}
          {visible('detalhe') ? <Th>Detalhe</Th> : null}
          <Th align="right">Valor</Th>
          <Th>
            <span className="sr-only">Ações</span>
          </Th>
        </THead>
        <tbody>
          {groups.map((group) => (
            <GroupRows
              key={group.id}
              group={group}
              categories={categories}
              today={today}
              layout={layout}
              onLaunch={onLaunch}
              actions={actions}
            />
          ))}
        </tbody>
      </FinTable>
      <Legend />
    </section>
  );
};

type Layout = {
  readonly visible: (id: string) => boolean;
  readonly colSpan: number;
};

const GroupRows = ({
  group,
  categories,
  today,
  layout,
  onLaunch,
  actions,
}: {
  readonly group: LedgerGroup;
  readonly categories: readonly Category[];
  readonly today: string;
  readonly layout: Layout;
  readonly onLaunch?: ((entry: Entry) => void) | undefined;
  readonly actions?: RowActions | undefined;
}): React.ReactElement => {
  const count = pluralize(group.entries.length, 'lançamento', 'lançamentos');
  const label =
    group.kind === 'previstos'
      ? 'Próximos dias · previstos'
      : group.kind === 'dia'
        ? formatDayHeader(group.date ?? today, today)
        : `${group.title ?? ''} · ${count}`;
  const summary =
    group.kind === 'previstos'
      ? `${count} · não entram nos totais do mês`
      : summaryText(group.summary);

  return (
    <>
      <SectionRow colSpan={layout.colSpan} label={label} summary={summary} />
      {group.entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          category={categories.find((c) => c.id === entry.categoryId)}
          today={today}
          layout={layout}
          categories={categories}
          onLaunch={onLaunch}
          actions={actions}
        />
      ))}
    </>
  );
};

const EntryRow = ({
  entry,
  category,
  today,
  layout,
  categories,
  onLaunch,
  actions,
}: {
  readonly entry: Entry;
  readonly category: Category | undefined;
  readonly today: string;
  readonly layout: Layout;
  readonly categories: readonly Category[];
  readonly onLaunch?: ((entry: Entry) => void) | undefined;
  readonly actions?: RowActions | undefined;
}): React.ReactElement => {
  const [editingCategory, setEditingCategory] = useState(false);
  const pending = entry.status === 'prevista';
  const split = entry.payments.length > 1;
  return (
    <>
      <Row>
        <Td className="tabular text-ink-2">{formatDate(entry.date, today)}</Td>
        <Td className="font-medium">{entry.description}</Td>
        <Td>
          {editingCategory && actions !== undefined ? (
            <Select
              invalid={false}
              aria-label={`Categoria de ${entry.description}`}
              autoFocus
              options={categories
                .filter((c) => c.kind === entry.kind)
                .map((c) => ({ id: c.id, name: c.name }))}
              value={entry.categoryId}
              onBlur={() => setEditingCategory(false)}
              onChange={(event) => {
                actions.onCategory(entry, event.target.value);
                setEditingCategory(false);
              }}
            />
          ) : category === undefined ? (
            '—'
          ) : pending || actions === undefined ? (
            <CategoryMarker color={categoryColor(category.color)} name={category.name} />
          ) : (
            <button
              type="button"
              aria-label={`Alterar categoria de ${entry.description}`}
              className="cursor-pointer rounded-control px-1 py-0.5 hover:bg-panel-2"
              onClick={(event) => {
                event.stopPropagation();
                setEditingCategory(true);
              }}
            >
              <CategoryMarker
                color={categoryColor(category.color)}
                name={category.name}
              />
            </button>
          )}
        </Td>
        <Td>{accountNames(entry).join(' + ')}</Td>
        <Td>
          {pending ? (
            <NatureTag kind="previsto" />
          ) : entry.recurringId === undefined ? null : (
            <NatureTag kind="recorrente" />
          )}
          {split ? (
            <span className={pending || entry.recurringId !== undefined ? 'ml-1.5' : ''}>
              <NatureTag kind="2 pagamentos" />
            </span>
          ) : null}
        </Td>
        <Td numeric className="font-semibold">
          <Amount
            cents={entry.kind === 'receita' ? entry.cents : -entry.cents}
            variant="flow"
          />
        </Td>
        <Td align="right" className="w-24">
          {pending ? (
            <Button
              disabled={onLaunch === undefined}
              onClick={() => onLaunch?.(entry)}
              aria-label={`Lançar ${entry.description}`}
            >
              Lançar
            </Button>
          ) : actions === undefined ? null : (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton row label={`Ações de ${entry.description}`} icon="dots" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-44">
                <DropdownMenuItem onSelect={() => actions.onEdit(entry)}>
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.onMove(entry)}>
                  Mover de conta
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={() => actions.onDelete(entry)}>
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </Td>
      </Row>
      {split
        ? entry.payments.map((payment) => (
            <PartRow
              key={payment.sourceId}
              sourceId={payment.sourceId}
              cents={payment.cents}
              layout={layout}
            />
          ))
        : null}
    </>
  );
};

/**
 * FIN-303 · Um subitem de despesa paga em partes: recuado, em tipografia
 * secundária, com a parte de cada origem. A soma é sempre o valor da linha (RN-21).
 */
const PartRow = ({
  sourceId,
  cents,
  layout,
}: {
  readonly sourceId: string;
  readonly cents: number;
  readonly layout: Layout;
}): React.ReactElement => (
  <tr data-part={sourceId} className="border-b border-line text-ink-3 last:border-b-0">
    {layout.visible('data') ? <td aria-hidden="true" /> : null}
    <td
      colSpan={
        ['descricao', 'categoria', 'conta', 'detalhe'].filter(layout.visible).length
      }
      className="border-l border-line-2 py-1.5 pl-4 text-[0.8125rem]"
    >
      Pago com {sourceName(sourceId)}
    </td>
    <td className="tabular px-3 py-1.5 text-right text-[0.8125rem]">
      {formatBRL(cents)}
    </td>
    <td aria-hidden="true" />
  </tr>
);

const Legend = (): React.ReactElement => (
  <footer className="flex flex-col gap-2 border-t border-line px-4 py-3 text-xs text-ink-3">
    <p className="flex flex-wrap items-center gap-x-5 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        <NatureTag kind="previsto" /> já existe como lançamento, mas só entra nos saldos e
        totais quando você lança
      </span>
      <span className="inline-flex items-center gap-1.5">
        <NatureTag kind="recorrente" /> repete todo mês
      </span>
      <span>
        <strong className="font-semibold text-ink-2">Lançar</strong> confirma o previsto,
        com o valor real
      </span>
    </p>
    <p>Receita ou despesa, categoria e conta também são filtros</p>
  </footer>
);
