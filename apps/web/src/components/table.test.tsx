import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { TableGroup } from '../lib/table/model.js';
import { Money, Percent } from './number.js';
import { PreferencesProvider } from './preferences.js';
import type { DataTableProps, TableColumn } from './table.js';
import { DataTable } from './table.js';

type Position = {
  readonly id: string;
  readonly ticker: string;
  readonly name: string;
  readonly value: string;
  readonly weight: string;
};

const position = (
  ticker: string,
  value: string,
  name = `${ticker} nome curto`,
): Position => ({ id: ticker, ticker, name, value, weight: '0.058' });

const columns: readonly TableColumn<Position>[] = [
  {
    id: 'ativo',
    header: 'Ativo',
    essential: true,
    flexible: true,
    sortable: true,
    sortValue: (row) => row.ticker,
    cell: (row) => (
      <span>
        <span className="font-medium">{row.ticker}</span>
        <span className="block truncate text-ink-3">{row.name}</span>
      </span>
    ),
  },
  {
    id: 'peso',
    header: 'Peso',
    numeric: true,
    hideBelow: 1100,
    cell: (row) => <Percent value={row.weight} decimals={1} />,
    summary: () => <Percent value="1" decimals={1} />,
  },
  {
    id: 'valor',
    header: 'Valor',
    numeric: true,
    essential: true,
    sortable: true,
    sortValue: (row) => row.value,
    cell: (row) => <Money value={row.value} />,
    summary: (summary) => <Money value={summary['valor'] ?? null} />,
  },
];

const acoes: TableGroup<Position> = {
  key: 'acoes',
  label: 'Ações',
  colorToken: 'class.acoes',
  rows: [
    position('ITUB4', '18420.00'),
    position('WEGE3', '15230.00'),
    position('EGIE3', '12375.00'),
    position('VALE3', '11680.00'),
    position('PETR4', '10818.80'),
    position('BBAS3', '9000.00'),
    position(
      'DEBCIA',
      '12345678.90',
      'Debênture Companhia de Saneamento de Minas Gerais série única',
    ),
  ],
  summary: { valor: '112640.35' },
};

const renderTable = (props: Partial<DataTableProps<Position>> = {}) =>
  render(
    <PreferencesProvider storage={null}>
      <DataTable<Position>
        screen="posicoes-teste"
        caption="Posições abertas"
        columns={columns}
        groups={[acoes]}
        rowId={(row) => row.id}
        rowLabel={(row) => row.ticker}
        total={{ valor: '487320.55' }}
        width={1440}
        {...props}
      />
    </PreferencesProvider>,
  );

describe('tabela densa', () => {
  it('o subtotal do grupo cobre as linhas escondidas atrás de "mostrar mais"', async () => {
    const user = userEvent.setup();
    renderTable();

    const subtotalBefore = screen.getByRole('row', { name: /Ações/u }).textContent;
    expect(screen.getByRole('button', { name: /Mostrar mais 2 ações/u })).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Mostrar mais 2 ações/u }));

    expect(screen.getByRole('row', { name: /Ações/u }).textContent).toBe(subtotalBefore);
    expect(screen.getByText('DEBCIA')).toBeVisible();
  });

  it('em 1.100 px as colunas secundárias somem', () => {
    renderTable({ width: 1099 });
    expect(screen.queryByRole('columnheader', { name: /Peso/u })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Valor/u })).toBeVisible();
  });

  it('em tela larga a coluna secundária volta', () => {
    renderTable({ width: 1440 });
    expect(screen.getByRole('columnheader', { name: /Peso/u })).toBeVisible();
  });

  it('ordenar por valor não embaralha a ordem dos grupos', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole('button', { name: /^Valor/u }));

    const rows = screen.getAllByRole('row');
    const first = rows.findIndex((row) => row.textContent?.includes('Ações') === true);
    expect(first).toBe(1);
  });

  it('a seta navega entre linhas e Enter abre', async () => {
    const user = userEvent.setup();
    const onOpenRow = vi.fn();
    renderTable({ onOpenRow });

    const itub = screen.getByRole('row', { name: 'ITUB4' });
    itub.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('row', { name: 'WEGE3' })).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onOpenRow).toHaveBeenCalledOnce();
  });

  it('`L` lança e `E` edita a linha com foco', async () => {
    const user = userEvent.setup();
    const onNewTransaction = vi.fn();
    const onEditRow = vi.fn();
    renderTable({ onNewTransaction, onEditRow });

    screen.getByRole('row', { name: 'ITUB4' }).focus();
    await user.keyboard('l');
    await user.keyboard('e');

    expect(onNewTransaction).toHaveBeenCalledOnce();
    expect(onEditRow).toHaveBeenCalledOnce();
  });

  it('nome longo trunca em vez de quebrar a linha em duas', () => {
    renderTable();
    const cell = screen.getByText('ITUB4').closest('td');
    expect(cell).toHaveClass('truncate');
    expect(cell).not.toHaveClass('whitespace-normal');
  });

  it('coluna de número nunca quebra', () => {
    renderTable();
    const valueCell = screen.getByText(/18\.420,00/u).closest('td');
    expect(valueCell).toHaveClass('whitespace-nowrap');
    expect(valueCell).toHaveClass('text-right');
  });

  it('fechar o grupo esconde as linhas e mantém o cabeçalho', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole('button', { name: /Ações/u }));

    expect(screen.queryByText('ITUB4')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ações/u })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('o total geral fecha a tabela', () => {
    renderTable();
    const rows = screen.getAllByRole('row');
    const last = rows.at(-1);
    expect(within(last as HTMLElement).getByText('Total')).toBeVisible();
    expect(last?.textContent).toContain('487.320,55');
  });

  it('desmarcar uma coluna a tira da tabela', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole('checkbox', { name: /Peso/u }));
    expect(screen.queryByRole('columnheader', { name: /Peso/u })).not.toBeInTheDocument();
  });

  it('filtro sem resultado mantém a barra e oferece sair do vazio', () => {
    renderTable({
      groups: [{ key: 'acoes', label: 'Ações', rows: [], summary: {} }],
      emptyState: <p>Nenhuma venda entre set e out de 2026</p>,
    });

    expect(screen.getByText(/Nenhuma venda/u)).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /Valor/u })).toBeVisible();
  });
});
