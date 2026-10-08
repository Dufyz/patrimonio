import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MASK } from '../lib/format.js';
import { Money, MoneyChange, Percent } from './number.js';
import { PreferencesProvider, usePreferences } from './preferences.js';

const Harness = ({ children }: { readonly children: React.ReactNode }) => (
  <PreferencesProvider storage={null}>{children}</PreferencesProvider>
);

const Toggle = (): React.ReactElement => {
  const { toggleHidden } = usePreferences();
  return (
    <button type="button" onClick={toggleHidden}>
      alternar
    </button>
  );
};

describe('componentes de número', () => {
  it('valor e variação saem em mono tabular, para alinhar em coluna', () => {
    render(
      <Harness>
        <Money value="1204.1" />
      </Harness>,
    );
    expect(screen.getByText(/1\.204,10/u)).toHaveClass('tabular');
  });

  it('ocultar troca os reais pela marca e preserva o percentual', async () => {
    const user = userEvent.setup();

    render(
      <Harness>
        <Money value="487320.55" />
        <Percent value="0.0031" signed />
        <Toggle />
      </Harness>,
    );

    expect(screen.getByText(/487\.320,55/u)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'alternar' }));

    expect(screen.queryByText(/487\.320,55/u)).not.toBeInTheDocument();
    expect(screen.getByText(`R$ ${MASK}`)).toBeInTheDocument();
    expect(screen.getByText('0,31%')).toBeInTheDocument();
  });

  it('um valor marcado como sempre visível ignora o modo oculto', async () => {
    const user = userEvent.setup();

    render(
      <Harness>
        <Money value="10" alwaysVisible />
        <Toggle />
      </Harness>,
    );

    await user.click(screen.getByRole('button', { name: 'alternar' }));
    expect(screen.getByText(/10,00/u)).toBeInTheDocument();
  });

  it('o valor oculto se anuncia para quem lê a tela por áudio', async () => {
    const user = userEvent.setup();

    render(
      <Harness>
        <Money value="1" />
        <Toggle />
      </Harness>,
    );

    expect(screen.queryByLabelText('valor oculto')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'alternar' }));
    expect(screen.getByLabelText('valor oculto')).toBeInTheDocument();
  });

  it('o sinal ocupa posição própria, então + e − caem um sobre o outro', () => {
    const { container } = render(
      <Harness>
        <MoneyChange value="-3170" />
      </Harness>,
    );

    const sign = container.querySelector('span > span');
    expect(sign?.textContent).toBe('−');
    expect(sign).toHaveClass('w-[1ch]');
  });

  it('variação negativa pega a cor de negativo; positiva, a de positivo', () => {
    const { container } = render(
      <Harness>
        <MoneyChange value="-3170" />
        <MoneyChange value="3170" />
      </Harness>,
    );

    const [negative, positive] = Array.from(container.querySelectorAll(':scope > span'));
    expect(negative).toHaveClass('text-negative');
    expect(negative?.textContent).toBe('−R$ 3.170,00');
    expect(positive).toHaveClass('text-positive');
    expect(positive?.textContent).toBe('+R$ 3.170,00');
  });
});
