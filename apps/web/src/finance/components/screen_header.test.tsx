import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { ScreenHeader } from './screen_header.js';

const wrap = (node: React.ReactNode) =>
  render(
    <MemoryRouter>
      <PreferencesProvider storage={null}>
        <ShortcutProvider>{node}</ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );

describe('cabeçalho padrão de tela', () => {
  it('mostra título, subtítulo e o botão principal com o selo N', () => {
    wrap(
      <ScreenHeader
        title="Contas"
        subtitle="Em contas R$ 11.773,15"
        primary={{ label: 'Conta', onClick: () => {} }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Contas' })).toBeVisible();
    expect(screen.getByText('Em contas R$ 11.773,15')).toBeVisible();
    expect(screen.getByRole('button', { name: /Conta/ })).toHaveTextContent('N');
  });

  it('a tecla N aciona o botão principal fora de campos de texto', async () => {
    const onClick = vi.fn();
    wrap(
      <ScreenHeader
        title="Cartões"
        subtitle="x"
        primary={{ label: 'Cartão', onClick }}
      />,
    );
    await userEvent.keyboard('n');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('migalhas: só o primeiro nível é um link', () => {
    wrap(
      <ScreenHeader
        title="Itaú Corrente"
        subtitle="x"
        crumbs={[{ label: 'Contas', to: '/financas/contas' }, { label: 'Itaú Corrente' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Contas' })).toHaveAttribute(
      'href',
      '/financas/contas',
    );
    expect(screen.queryByRole('link', { name: 'Itaú Corrente' })).toBeNull();
  });

  it('ocultar valores alterna o estado e o rótulo do botão', async () => {
    wrap(<ScreenHeader title="x" subtitle="y" />);
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar valores' }));
    expect(screen.getByRole('button', { name: 'Mostrar valores' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('recebe o período e os botões secundários antes do principal', () => {
    wrap(
      <ScreenHeader
        title="Contas"
        subtitle="x"
        period={<span>01/10 – 31/10</span>}
        extra={<button type="button">Transferir</button>}
        primary={{ label: 'Conta', onClick: () => {} }}
      />,
    );
    expect(screen.getByText('01/10 – 31/10')).toBeVisible();
    expect(screen.getByRole('button', { name: /^Transferir(?:\s*⌘↵)?$/ })).toBeVisible();
  });
});
