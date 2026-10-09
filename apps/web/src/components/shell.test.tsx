import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Compact } from './number.js';
import { ConfirmDialog, InfoTip, Menu } from './overlay.js';
import { PreferencesProvider } from './preferences.js';
import { SearchSelect } from './search_select.js';
import { AppShell } from './shell.js';
import { ShortcutProvider, useShortcuts } from './shortcuts.js';

const portfolios = [
  { id: 'longo', label: 'Longo prazo', value: '318904.12' },
  { id: 'imovel', label: 'Entrada do imóvel', value: '84800' },
  { id: 'reserva', label: 'Reserva', value: '62400' },
];

const screens = [
  { id: 'visao', label: 'Visão geral', icon: '▦' },
  { id: 'posicoes', label: 'Posições', icon: '≡' },
  { id: 'movimentacoes', label: 'Movimentações', icon: '⇄' },
];

const wrap = (node: React.ReactNode) =>
  render(
    <PreferencesProvider storage={null}>
      <ShortcutProvider>{node}</ShortcutProvider>
    </PreferencesProvider>,
  );

const shell = (props: Partial<React.ComponentProps<typeof AppShell>> = {}) => {
  const onNavigate = props.onNavigate ?? vi.fn();
  wrap(
    <AppShell
      portfolios={portfolios}
      screens={screens}
      scope="longo"
      screen="posicoes"
      onNavigate={onNavigate}
      onOpenSearch={vi.fn()}
      onOpenSettings={vi.fn()}
      width={1440}
      {...props}
    >
      <p>conteúdo da tela</p>
    </AppShell>,
  );
  return onNavigate;
};

describe('moldura da aplicação', () => {
  it('a barra lateral mostra o valor de cada carteira', () => {
    shell();
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('318,9k')).toBeVisible();
    expect(within(nav).getByText('84,8k')).toBeVisible();
  });

  it('trocar de carteira mantém a tela atual', async () => {
    const user = userEvent.setup();
    const onNavigate = shell();

    await user.click(screen.getByRole('button', { name: /Entrada do imóvel/u }));

    expect(onNavigate).toHaveBeenCalledWith('imovel', 'posicoes');
  });

  it('trocar de tela mantém a carteira', async () => {
    const user = userEvent.setup();
    const onNavigate = shell();

    await user.click(screen.getByRole('button', { name: /Visão geral/u }));

    expect(onNavigate).toHaveBeenCalledWith('longo', 'visao');
  });

  it('as telas ficam sob o nome da carteira escolhida', () => {
    shell();
    // Duas vezes: na lista de carteiras e como título do grupo de telas, que é
    // o que deixa claro de qual carteira é a tabela na tela.
    const occurrences = screen.getAllByText('Longo prazo');
    expect(occurrences).toHaveLength(2);
    expect(occurrences.some((node) => node.className.includes('uppercase'))).toBe(true);
  });

  it('a tela atual se anuncia como tal', () => {
    shell();
    expect(screen.getByRole('button', { name: /Posições/u })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('em tela média a barra lateral colapsa para ícones', () => {
    shell({ width: 1100 });
    expect(screen.queryByText('Buscar')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation')).toHaveClass('w-14');
  });

  it('em tela estreita a barra lateral vira gaveta, sem perder a seleção', async () => {
    const user = userEvent.setup();
    shell({ width: 820 });

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abrir a barra lateral' }));

    expect(screen.getByRole('button', { name: /Posições/u })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('sobreposições', () => {
  const items = [
    { id: 'lancar', label: 'Lançar compra ou venda', shortcut: 'L', onSelect: vi.fn() },
    { id: 'abrir', label: 'Abrir ativo', onSelect: vi.fn() },
    { id: 'excluir', label: 'Excluir', destructive: true, onSelect: vi.fn() },
  ];

  it('o menu nasce fechado', () => {
    wrap(<Menu label="Ações da posição" items={items} />);
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('o menu abre, fecha com Esc e devolve o foco a quem o abriu', async () => {
    const user = userEvent.setup();
    wrap(<Menu label="Ações da posição" items={items} />);

    const trigger = screen.getByRole('button', { name: 'Ações da posição' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeVisible();

    const entries = screen.getAllByRole('menuitem');
    expect(entries.at(-1)).toHaveTextContent('Excluir');
    expect(entries.at(-1)).toHaveClass('text-negative');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('o menu fecha com clique fora', async () => {
    const user = userEvent.setup();
    wrap(
      <div>
        <Menu label="Ações da posição" items={items} />
        <p>fora do menu</p>
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Ações da posição' }));
    await user.click(screen.getByText('fora do menu'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('a confirmação nomeia exatamente o que será excluído', () => {
    wrap(
      <ConfirmDialog
        open
        title="Excluir carteira"
        subject="a carteira Longo prazo, com 28 posições e 412 lançamentos"
        consequence="Os lançamentos são apagados junto; não dá para desfazer."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByText('a carteira Longo prazo, com 28 posições e 412 lançamentos'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Excluir' })).toHaveClass('text-negative');
  });

  it('a dica de informação abre pelo teclado', async () => {
    const user = userEvent.setup();
    wrap(<InfoTip label="O que é cota">A cota isola o efeito dos aportes.</InfoTip>);

    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveTextContent('A cota isola');
  });

  it('o seletor com poucas opções não mostra campo de busca', async () => {
    const user = userEvent.setup();
    wrap(
      <SearchSelect
        label="Carteira"
        value="longo"
        onChange={vi.fn()}
        options={portfolios.map((portfolio) => ({
          id: portfolio.id,
          label: portfolio.label,
          value: portfolio.value,
        }))}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Carteira' }));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('a partir de seis opções o seletor busca por digitação', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    wrap(
      <SearchSelect
        label="Ativo"
        value={null}
        onChange={onChange}
        options={[
          { id: 'ITUB4', label: 'ITUB4', hint: 'Itaú Unibanco PN' },
          { id: 'ITUB3', label: 'ITUB3', hint: 'Itaú Unibanco ON' },
          { id: 'WEGE3', label: 'WEGE3', hint: 'WEG ON' },
          { id: 'VALE3', label: 'VALE3', hint: 'Vale ON' },
          { id: 'PETR4', label: 'PETR4', hint: 'Petrobras PN' },
          { id: 'EGIE3', label: 'EGIE3', hint: 'Engie ON' },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Ativo' }));
    await user.type(screen.getByRole('searchbox'), 'itu');

    expect(screen.getAllByRole('option')).toHaveLength(2);

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('ITUB3');
  });
});

const Screen = ({ onEdit }: { readonly onEdit: () => void }): React.ReactElement => {
  const [value, setValue] = useState('');
  const handlers = useMemo(() => ({ row_edit: onEdit }), [onEdit]);
  useShortcuts(handlers);

  return (
    <label>
      Observação
      <input value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
};

describe('atalhos de teclado', () => {
  it('a tela registra o que o atalho faz', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    wrap(<Screen onEdit={onEdit} />);

    await user.keyboard('e');
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('nenhum atalho dispara com o foco em campo de texto', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    wrap(<Screen onEdit={onEdit} />);

    await user.click(screen.getByLabelText('Observação'));
    await user.type(screen.getByLabelText('Observação'), 'entrada e saída');

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Observação')).toHaveValue('entrada e saída');
  });

  it('a ajuda lista todos os atalhos ativos', async () => {
    const user = userEvent.setup();
    wrap(<Screen onEdit={vi.fn()} />);

    await user.keyboard('?');

    const dialog = screen.getByRole('dialog', { name: 'Atalhos de teclado' });
    expect(within(dialog).getByText('Posições')).toBeVisible();
    expect(within(dialog).getByText('G P')).toBeVisible();
    expect(within(dialog).getByText('⌘K')).toBeVisible();
  });

  it('`H` esconde os valores de qualquer lugar', async () => {
    const user = userEvent.setup();
    wrap(
      <div>
        <Screen onEdit={vi.fn()} />
        <Compact value="318904.12" />
      </div>,
    );

    expect(screen.getByText('318,9k')).toBeVisible();
    await user.keyboard('h');
    expect(screen.queryByText('318,9k')).not.toBeInTheDocument();
  });
});
