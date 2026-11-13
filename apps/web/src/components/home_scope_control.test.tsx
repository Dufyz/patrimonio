import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import { HomeScopeControl } from './home_scope_control.js';
import { PortfoliosProvider } from './portfolios_provider.js';

const Where = (): React.ReactElement => {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{`${pathname}${search}`}</output>;
};

describe('HomeScopeControl', () => {
  it('Tudo | Fluxo | Investimentos escreve o escopo na URL, e Tudo é o padrão sem parâmetro', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <PortfoliosProvider>
          <HomeScopeControl scope="tudo" />
          <Where />
        </PortfoliosProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('radio', { name: 'Fluxo' }));
    expect(screen.getByTestId('where').textContent).toBe('/?escopo=fluxo');

    await user.click(screen.getByRole('radio', { name: 'Tudo' }));
    expect(screen.getByTestId('where').textContent).toBe('/');
  });
});
