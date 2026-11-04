import { Button } from '../../components/primitives.js';
import { Amount } from './amount.js';
import { CategoryMarker, FinTable, Row, SectionRow, Td, Th, THead } from './fin_table.js';
import { NatureTag } from './tags.js';
import { accountNames } from '../domain/ledger.js';
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

const COLUMN_COUNT = 7;

/** `despesas R$ 4.500,00` ou `receitas … · despesas …`. */
export const summaryText = (summary: GroupSummary): string =>
  [
    summary.receitas === undefined ? null : `receitas ${formatBRL(summary.receitas)}`,
    summary.despesas === undefined ? null : `despesas ${formatBRL(summary.despesas)}`,
    summary.previsto === undefined ? null : `previsto ${formatBRL(summary.previsto)}`,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

export const LedgerTable = ({
  groups,
  categories,
  today,
  onLaunch,
}: {
  readonly groups: readonly LedgerGroup[];
  readonly categories: readonly Category[];
  readonly today: string;
  readonly onLaunch?: ((entry: Entry) => void) | undefined;
}): React.ReactElement => (
  <section className="rounded-panel border border-line bg-panel">
    <FinTable caption="Lançamentos">
      <THead>
        <Th>Data</Th>
        <Th>Descrição</Th>
        <Th>Categoria</Th>
        <Th>Conta</Th>
        <Th>Detalhe</Th>
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
            onLaunch={onLaunch}
          />
        ))}
      </tbody>
    </FinTable>
    <Legend />
  </section>
);

const GroupRows = ({
  group,
  categories,
  today,
  onLaunch,
}: {
  readonly group: LedgerGroup;
  readonly categories: readonly Category[];
  readonly today: string;
  readonly onLaunch?: ((entry: Entry) => void) | undefined;
}): React.ReactElement => {
  const label =
    group.kind === 'previstos'
      ? 'Próximos dias · previstos'
      : formatDayHeader(group.date ?? today, today);
  const summary =
    group.kind === 'previstos'
      ? `${pluralize(group.entries.length, 'lançamento', 'lançamentos')} · não entram nos totais do mês`
      : summaryText(group.summary);

  return (
    <>
      <SectionRow colSpan={COLUMN_COUNT} label={label} summary={summary} />
      {group.entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          category={categories.find((c) => c.id === entry.categoryId)}
          today={today}
          onLaunch={onLaunch}
        />
      ))}
    </>
  );
};

const EntryRow = ({
  entry,
  category,
  today,
  onLaunch,
}: {
  readonly entry: Entry;
  readonly category: Category | undefined;
  readonly today: string;
  readonly onLaunch?: ((entry: Entry) => void) | undefined;
}): React.ReactElement => {
  const pending = entry.status === 'prevista';
  return (
    <Row>
      <Td className="tabular text-ink-2">{formatDate(entry.date, today)}</Td>
      <Td className="font-medium">{entry.description}</Td>
      <Td>
        {category === undefined ? (
          '—'
        ) : (
          <CategoryMarker color={categoryColor(category.color)} name={category.name} />
        )}
      </Td>
      <Td>{accountNames(entry).join(' + ')}</Td>
      <Td>
        {pending ? (
          <NatureTag kind="previsto" />
        ) : entry.recurringId === undefined ? null : (
          <NatureTag kind="recorrente" />
        )}
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
        ) : null}
      </Td>
    </Row>
  );
};

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
