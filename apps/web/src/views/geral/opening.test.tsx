import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { FinancePeriodProvider } from '../../finance/components/period_provider.js';
import { setTodayOverride } from '../../finance/lib/clock.js';
import {
  FinanceStoreProvider,
  createFinanceStore,
} from '../../finance/store/finance_store.js';
import { GeralScreen } from './geral_screen.js';

/**
 * VGR-19 · O orçamento de requisições da abertura da Visão geral. Cada leitura
 * serve todos os painéis: nenhuma URL é pedida duas vezes e o total não passa
 * do teto declarado aqui.
 */
const OPENING_REQUEST_BUDGET = 8;

afterEach(() => vi.unstubAllGlobals());

describe('VGR-19 · abertura da Visão geral', () => {
  it('não repete leitura e fica dentro do orçamento de requisições', async () => {
    setTodayOverride('2026-11-11');
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        return new Response('{}', { status: 200 });
      }),
    );
    render(
      <MemoryRouter>
        <PreferencesProvider storage={null}>
          <ShortcutProvider>
            <FinanceStoreProvider store={createFinanceStore(null)}>
              <FinancePeriodProvider>
                <GeralScreen />
              </FinancePeriodProvider>
            </FinanceStoreProvider>
          </ShortcutProvider>
        </PreferencesProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(urls.length).toBeGreaterThan(2));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.length).toBeLessThanOrEqual(OPENING_REQUEST_BUDGET);
  });
});
