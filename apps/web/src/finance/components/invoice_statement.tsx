import { IconButton } from '../../components/primitives.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import { categoryColor } from '../lib/category_colors.js';
import { formatBRL, formatDay } from '../lib/format.js';
import { Amount } from './amount.js';
import { CategoryMarker, FinTable, Row, SectionRow, Td, Th, THead } from './fin_table.js';
import { NatureTag } from './tags.js';
import type { InvoiceBlock, InvoiceLine } from '../domain/cards.js';
import { invoiceTotals } from '../domain/cards.js';
import type { Category } from '../domain/types.js';

/**
 * FIN-505 · O extrato completo da fatura: quatro blocos, nesta ordem, cada um
 * com linha de seção e subtotal, e a linha do total (RN-44).
 */

const BLOCKS: readonly {
  readonly id: InvoiceBlock;
  readonly title: string;
}[] = [
  { id: 'compras', title: 'Compras do período' },
  { id: 'parcelas', title: 'Parcelas de compras anteriores' },
  { id: 'creditos', title: 'Créditos e ajustes' },
  { id: 'encargos', title: 'Encargos' },
];

const NOTES: Readonly<Record<InvoiceBlock, string>> = {
  compras: '',
  parcelas: '',
  creditos: 'devoluções, estornos, descontos e cashback',
  encargos: 'juros, multa e IOF',
};

const EMPTY: Readonly<Record<InvoiceBlock, string>> = {
  compras: 'nenhuma compra nesta fatura',
  parcelas: 'nenhuma parcela nesta fatura',
  creditos: 'nenhum crédito nesta fatura',
  encargos: 'nenhum nesta fatura',
};

export const InvoiceStatement = ({
  lines,
  categories,
  period,
  today,
  locked,
  onEdit,
  onDelete,
  blockAction,
}: {
  readonly lines: readonly InvoiceLine[];
  readonly categories: readonly Category[];
  readonly period: { readonly from: string; readonly to: string };
  readonly today: string;
  /** Fatura paga: as linhas ficam somente para leitura (RN-53). */
  readonly locked: boolean;
  readonly onEdit: (line: InvoiceLine) => void;
  readonly onDelete: (line: InvoiceLine) => void;
  /** Uma ação no cabeçalho de um bloco, como "Lançar encargo". */
  readonly blockAction?: ((block: InvoiceBlock) => React.ReactNode) | undefined;
}): React.ReactElement => {
  const totals = invoiceTotals(lines);
  const subtotal: Readonly<Record<InvoiceBlock, number>> = totals;

  return (
    <section className="rounded-panel border border-line bg-panel">
      <FinTable caption="Extrato da fatura">
        <THead>
          <Th>Data</Th>
          <Th>Descrição</Th>
          <Th>Categoria</Th>
          <Th align="right">Valor</Th>
          <Th>
            <span className="sr-only">Ações</span>
          </Th>
        </THead>
        <tbody>
          {BLOCKS.map((block) => {
            const rows = lines.filter((line) => line.block === block.id);
            const note =
              block.id === 'compras'
                ? `${formatDay(period.from, today)} a ${formatDay(period.to, today)} · ${rows.length} ${
                    rows.length === 1 ? 'lançamento' : 'lançamentos'
                  }`
                : NOTES[block.id];
            return (
              <Block
                key={block.id}
                title={block.title}
                note={note}
                subtotal={formatBRL(subtotal[block.id])}
                action={blockAction?.(block.id)}
              >
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-[0.8125rem] text-ink-3">
                      {EMPTY[block.id]}
                    </td>
                  </tr>
                ) : (
                  rows.map((line) => (
                    <LineRow
                      key={line.id}
                      line={line}
                      category={categories.find((c) => c.id === line.categoryId)}
                      today={today}
                      locked={locked}
                      onEdit={() => onEdit(line)}
                      onDelete={() => onDelete(line)}
                    />
                  ))
                )}
              </Block>
            );
          })}
          <tr className="border-t border-line bg-panel-2 font-semibold">
            <td colSpan={3} className="px-3 py-2">
              Total da fatura
            </td>
            <td className="tabular px-3 py-2 text-right">
              <Amount cents={totals.total} />
            </td>
            <td />
          </tr>
        </tbody>
      </FinTable>
    </section>
  );
};

const Block = ({
  title,
  note,
  subtotal,
  action,
  children,
}: {
  readonly title: string;
  readonly note: string;
  readonly subtotal: string;
  readonly action: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <>
    <SectionRow
      colSpan={5}
      label={
        <span className="inline-flex items-baseline gap-3">
          {title}
          {note === '' ? null : <span className="font-normal text-ink-3">{note}</span>}
        </span>
      }
      summary={
        <span className="inline-flex items-center gap-3">
          {action}
          <span className="tabular">{subtotal}</span>
        </span>
      }
    />
    {children}
  </>
);

const TYPE_LABEL: Readonly<Record<string, string>> = {
  devolucao: 'devolução',
  estorno: 'estorno',
  desconto: 'desconto',
  cashback: 'cashback',
  juros: 'juros',
  multa: 'multa',
  iof: 'IOF',
};

const LineRow = ({
  line,
  category,
  today,
  locked,
  onEdit,
  onDelete,
}: {
  readonly line: InvoiceLine;
  readonly category: Category | undefined;
  readonly today: string;
  readonly locked: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}): React.ReactElement => {
  const credit = line.block === 'creditos';
  return (
    <Row label={line.description}>
      <Td className="tabular text-ink-2">{formatDay(line.date, today)}</Td>
      <Td>
        <span className="inline-flex flex-wrap items-center gap-2">
          {line.description}
          {line.installment === undefined ? null : (
            <NatureTag kind={`parcela ${line.installment.n}/${line.installment.of}`} />
          )}
          {line.subtype === undefined ? null : (
            <NatureTag kind={TYPE_LABEL[line.subtype] ?? line.subtype} />
          )}
          {line.forecast ? <NatureTag kind="previsto" /> : null}
        </span>
      </Td>
      <Td>
        {category === undefined ? (
          '—'
        ) : (
          <CategoryMarker color={categoryColor(category.color)} name={category.name} />
        )}
      </Td>
      <Td numeric>
        <Amount cents={line.cents} variant={credit ? 'flow' : 'plain'} />
      </Td>
      <Td align="right" className="w-12">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton row label={`Ações de ${line.description}`} icon="dots" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-40">
            <DropdownMenuItem disabled={locked} onSelect={onEdit}>
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem disabled={locked} onSelect={onDelete}>
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Td>
    </Row>
  );
};
