import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import type { FilterState } from '../lib/filters.js';
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
      screen.getByRole('button', { name: 'Filtrar' }),
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
    expect(screen.getByRole('button', { name: 'Filtrar' })).toHaveTextContent('F');
  });

  it('F abre os filtros e a contagem aparece no botão', async () => {
    wrap(<Harness />);
    await userEvent.keyboard('f');
    const dialog = await screen.findByRole('dialog', { name: 'Filtros' });

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Despesa' }));
    expect(screen.getByRole('button', { name: 'Filtrar, 1 ativos' })).toBeVisible();
  });

  it('filtros ativos são etiquetas removíveis um a um', async () => {
    wrap(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Filtros' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Despesa' }));
    expect(screen.getByText('Tipo: Despesa')).toBeVisible();

    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /Remover/ }));
    expect(screen.queryByText('Tipo: Despesa')).toBeNull();
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
    const dialog = await screen.findByRole('dialog', { name: 'Exibição' });
    expect(within(dialog).getByRole('checkbox', { name: 'Descrição' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Conta' }));
    expect(within(dialog).getByRole('checkbox', { name: 'Conta' })).not.toBeChecked();
  });

  it('exportar chama a ação da tela', async () => {
    const onExport = vi.fn();
    wrap(<Harness onExport={onExport} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    expect(onExport).toHaveBeenCalled();
  });
});
