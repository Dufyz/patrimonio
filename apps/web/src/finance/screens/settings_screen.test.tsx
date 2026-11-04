import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { SettingsScreen } from './settings_screen.js';

const open = () =>
  render(
    <MemoryRouter>
      <PreferencesProvider>
        <ShortcutProvider>
          <SettingsScreen />
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );

describe('tema de Finanças', () => {
  it('acompanha o sistema na primeira abertura', () => {
    open();
    expect(screen.getByRole('radio', { name: 'Sistema' })).toBeChecked();
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('troca manualmente para o escuro, aplica no documento e persiste', async () => {
    open();
    await userEvent.click(screen.getByRole('radio', { name: 'Escuro' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(globalThis.localStorage.getItem('patrimonio.theme')).toBe('dark');
  });

  it('volta a abrir no escuro quando a escolha foi gravada', () => {
    globalThis.localStorage.setItem('patrimonio.theme', 'dark');
    open();
    expect(screen.getByRole('radio', { name: 'Escuro' })).toBeChecked();
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});
