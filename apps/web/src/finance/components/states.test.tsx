import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EmptyPanel, FinanceLoading, PanelBoundary } from './states.js';

const Boom = ({ fail }: { readonly fail: boolean }): React.ReactElement => {
  if (fail) throw new Error('A conexão caiu');
  return <p>Painel pronto</p>;
};

const Harness = (): React.ReactElement => {
  const [fail, setFail] = useState(true);
  return (
    <>
      <button onClick={() => setFail(false)}>Consertar</button>
      <PanelBoundary title="o gráfico">
        <Boom fail={fail} />
      </PanelBoundary>
      <p>Resto da tela</p>
    </>
  );
};

describe('estados (FIN-701)', () => {
  it('o carregamento é uma região ocupada, sem número nenhum', () => {
    render(<FinanceLoading />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.textContent).toBe('Carregando Finanças');
    expect(region.textContent).not.toMatch(/\d/);
  });

  it('vazio: mensagem curta e a ação principal', async () => {
    const onAction = vi.fn();
    render(
      <EmptyPanel
        message="Nenhuma conta."
        actionLabel="Nova conta"
        onAction={onAction}
      />,
    );
    expect(screen.getByText('Nenhuma conta.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Nova conta' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('erro: o painel mostra a causa e Tentar novamente, sem derrubar a tela', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness />);
    expect(screen.getByRole('alert').textContent).toContain(
      'Não foi possível carregar o gráfico',
    );
    expect(screen.getByRole('alert').textContent).toContain('A conexão caiu');
    expect(screen.getByText('Resto da tela')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Consertar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(screen.getByText('Painel pronto')).toBeTruthy();
    spy.mockRestore();
  });
});
