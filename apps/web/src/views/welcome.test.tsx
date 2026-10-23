import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import { WelcomeScreen } from './welcome.js';

const show = (onOpenSettings = () => {}) =>
  render(
    <PreferencesProvider storage={null}>
      <WelcomeScreen onOpenSettings={onOpenSettings} />
    </PreferencesProvider>,
  );

describe('tela de quem não tem carteira', () => {
  it('diz que falta a primeira carteira e oferece criá-la', () => {
    show();

    expect(
      screen.getByRole('heading', {
        name: 'Seu patrimônio aparece aqui depois do primeiro lançamento',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Criar primeira carteira/ }),
    ).toBeInTheDocument();
  });

  it('explica o caminho em três passos', () => {
    show();

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Crie uma carteira')).toBeInTheDocument();
    expect(screen.getByText('Defina a estratégia')).toBeInTheDocument();
  });

  it('criar a carteira abre o modal de nova carteira', async () => {
    show();

    await userEvent.click(
      screen.getByRole('button', { name: /Criar primeira carteira/ }),
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Nova carteira')).toBeInTheDocument();
  });

  it('Configurações continua a um clique', async () => {
    const onOpenSettings = vi.fn();
    show(onOpenSettings);

    await userEvent.click(screen.getByRole('button', { name: 'Abrir configurações' }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
