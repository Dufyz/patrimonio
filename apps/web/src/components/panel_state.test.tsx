import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PanelEmpty, PanelFailed, ScreenFailed } from './panel_state.js';

describe('estados de painel (CMP-08)', () => {
  it('a tela que falhou diz a causa e oferece Tentar novamente', async () => {
    const retry = vi.fn();
    render(<ScreenFailed error={new Error('A api não respondeu')} onRetry={retry} />);

    expect(screen.getByRole('alert').textContent).toContain('A api não respondeu');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('o painel que falhou nomeia o que não carregou e não derruba quem está ao lado', async () => {
    const retry = vi.fn();
    render(
      <>
        <PanelFailed error={new Error('timeout')} onRetry={retry} what="os lotes" />
        <p>outro painel segue de pé</p>
      </>,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'Não foi possível ler os lotes',
    );
    expect(screen.getByText('outro painel segue de pé')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('o vazio traz a mensagem e, com filtro, Limpar filtros', async () => {
    const clear = vi.fn();
    const { rerender } = render(<PanelEmpty message="Nenhum lançamento no período." />);
    expect(screen.getByText('Nenhum lançamento no período.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();

    rerender(<PanelEmpty message="Nenhum resultado." onClearFilters={clear} />);
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(clear).toHaveBeenCalledOnce();
  });
});
