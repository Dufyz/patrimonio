import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { readDisplay } from '../../lib/display_preferences.js';
import { DisplaySection } from './preferences.js';

describe('Exibição (CFG-02)', () => {
  beforeEach(() => window.localStorage.clear());

  it('escolher escopo, período e formato persiste e lista os atalhos', async () => {
    const user = userEvent.setup();
    render(
      <PreferencesProvider storage={null}>
        <DisplaySection />
      </PreferencesProvider>,
    );

    await user.selectOptions(screen.getByLabelText('Escopo da Visão geral'), 'fluxo');
    await user.selectOptions(screen.getByLabelText('Período padrão'), 'ano-ate-hoje');
    await user.selectOptions(screen.getByLabelText('Data'), 'iso');

    expect(readDisplay()).toMatchObject({
      homeScope: 'fluxo',
      defaultPeriod: 'ano-ate-hoje',
      dateFormat: 'iso',
    });
    expect(screen.getByText('Buscar em tudo')).toBeTruthy();
  });
});
