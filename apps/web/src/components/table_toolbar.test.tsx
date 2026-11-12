import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from './preferences.js';
import { ShortcutProvider } from './shortcuts.js';
import type { FilterState } from '../finance/lib/filters.js';
import { TableToolbar } from './table_toolbar.js';

const FIELDS = [
  {
    id: 'tipo',
    label: 'Tipo',
    options: [
      { value: 'expense', label: 'Despesa' },
      { value: 'income', label: 'Receita' },
    ],
  },
];
const COLUMNS = [
  { id: 'descricao', label: 'Descrição', locked: true },
  { id: 'conta', label: 'Conta' },
];

const Harness = ({ onExport = () => {} }: { readonly onExport?: () => void }) => {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>({});
  const [hidden, setHidden] = useState<readonly string[]>([]);
  return (
    <TableToolbar
      searchPlaceholder="Buscar lançamento"
      search={search}
      onSearch={setSearch}
      counter="15 categorias"
      filterFields={FIELDS}
      filters={filters}
      onFilters={setFilters}
      columns={COLUMNS}
      hiddenColumns={hidden}
      onHiddenColumns={setHidden}
      onExport={onExport}
    />
  );
};

const wrap = (node: React.ReactNode) =>
  render(
    <PreferencesProvider storage={null}>
      <ShortcutProvider>{node}</ShortcutProvider>
    </PreferencesProvider>,
  );

describe('barra de ferramentas da tabela', () => {
  it('ordem fixa: busca, contador, Filtrar com F, Exibição e exportar', () => {
    wrap(<Harness />);
    const order = [
      screen.getByRole('searchbox', { name: 'Buscar lançamento' }),
      screen.getByText('15 categorias'),
      screen.getByRole('button', { name: /^Filtrar/ }),
      screen.getByRole('button', { name: 'Exibição' }),
      screen.getByRole('button', { name: 'Exportar' }),
    ];
    for (let index = 1; index < order.length; index += 1) {
      const previous = order[index - 1]!;
      const next = order[index]!;
      expect(
        previous.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /^Filtrar/ })).toHaveTextContent('F');
  });

  it('F abre os filtros e a contagem aparece no botão', async () => {
    wrap(<Harness />);
    await userEvent.keyboard('f');
    await userEvent.click(await screen.findByRole('menuitem', { name: /Tipo/ }));
    const list = await screen.findByRole('group', { name: 'Tipo' });

    await userEvent.click(within(list).getByRole('checkbox', { name: /Despesa/ }));
    expect(screen.getByRole('button', { name: /^Filtrar/ })).toHaveTextContent('1');
  });

  it('filtros ativos viram etiquetas com campo, operador e valor', async () => {
    wrap(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: /^Filtrar/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Tipo/ }));
    const list = await screen.findByRole('group', { name: 'Tipo' });
    await userEvent.click(within(list).getByRole('checkbox', { name: /Despesa/ }));

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Editar filtro Tipo' })).toHaveTextContent(
      'Despesa',
    );
  });

  it('a busca é controlada enquanto digita', async () => {
    wrap(<Harness />);
    const box = screen.getByRole('searchbox', { name: 'Buscar lançamento' });
    await userEvent.type(box, 'luz');
    expect(box).toHaveValue('luz');
  });

  it('Exibição não deixa ocultar a coluna fixa', async () => {
    wrap(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Exibição' }));
    expect(screen.queryByRole('button', { name: 'Descrição' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Conta' }));
    expect(screen.getByRole('button', { name: 'Conta' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('exportar chama a ação da tela', async () => {
    const onExport = vi.fn();
    wrap(<Harness onExport={onExport} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(onExport).toHaveBeenCalled();
  });
});
