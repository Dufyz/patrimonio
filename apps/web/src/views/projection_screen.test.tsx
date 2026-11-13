import axe from 'axe-core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import { ShortcutProvider } from '../components/shortcuts.js';
import { ProjectionScreen } from './projection_screen.js';

const point = (month: string, value: string, acc: string, yielded: string) => ({
  month,
  value,
  contributions_cumulative: acc,
  yield_cumulative: yielded,
});

const result = {
  series: [
    point('2026-11', '10000.00', '0.00', '0.00'),
    point('2026-12', '11100.00', '1000.00', '100.00'),
  ],
  kpis: {
    today: '10000.00',
    at_horizon: '11100.00',
    contributions: '1000.00',
    estimated_yield: '100.00',
  },
};

const body = {
  horizon_months: 24,
  as_of: '2026-11-13',
  portfolios: [
    {
      portfolio_id: '019b0000-0000-7000-8000-000000000001',
      name: 'Emergência',
      expected_return_pct: '13.75',
      return_assumed_zero: false,
      version: '2026-11-01T12:00:00.000Z',
      current_value: '10000.00',
      as_of: '2026-11-12',
      rules: [{ amount: '1000.00', from: '2026-11', until: null }],
      projection: result,
    },
    {
      portfolio_id: '019b0000-0000-7000-8000-000000000002',
      name: 'Investimentos',
      expected_return_pct: null,
      return_assumed_zero: true,
      version: '2026-11-01T12:00:00.000Z',
      current_value: null,
      as_of: null,
      rules: [],
      projection: null,
    },
  ],
  total: result,
};

const calls: { url: string; method: string; body?: string }[] = [];

const show = (portfolioId: string | null = null, initial = '/projecao') => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      });
      return new Response(
        JSON.stringify(init?.method === 'PUT' ? { message: 'ok' } : body),
        {
          status: 200,
        },
      );
    }),
  );
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <PreferencesProvider storage={null}>
        <ShortcutProvider>
          <ProjectionScreen portfolioId={portfolioId} scopeLabel="Todas as carteiras" />
        </ShortcutProvider>
      </PreferencesProvider>
    </MemoryRouter>,
  );
};

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe('Projeção', () => {
  it('lê a projeção do servidor com o horizonte padrão e mostra os quatro KPIs', async () => {
    show();

    expect(await screen.findByText('Projeção · Todas as carteiras')).toBeTruthy();
    expect(calls[0]?.url).toBe('/api/projection?horizon=24');
    for (const label of [
      'Hoje',
      'No horizonte',
      'Aportes no período',
      'Rendimento estimado',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('o horizonte vai para o pedido', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Hoje');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Horizonte' }), '60');

    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/projection?horizon=60'));
  });

  it('carteira sem consolidação aparece com traço e aviso, e a sem rentabilidade avisa o 0,00%', async () => {
    show();
    await screen.findByText('Hoje');

    expect(
      screen.getByText(/Carteira ainda não consolidada: Investimentos/),
    ).toBeTruthy();
    expect(screen.getByText(/sem rentabilidade: usando 0,00%/)).toBeTruthy();
    expect(screen.getByText(/Sem aportes planejados/)).toBeTruthy();
  });

  it('editar a rentabilidade abre a barra de salvar, e salvar grava no servidor', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Hoje');

    const field = screen.getByRole('textbox', {
      name: 'Rentabilidade esperada de Emergência',
    });
    await user.clear(field);
    await user.type(field, '14,50');
    const bar = screen.getByRole('region', { name: 'Salvar plano' });
    await user.click(within(bar).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'PUT')).toBe(true));
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.url).toContain('/projection-plan');
    expect(JSON.parse(put?.body ?? '{}')).toMatchObject({ expected_return_pct: '14.50' });
  });

  it('rentabilidade inválida trava o salvar', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Hoje');

    const field = screen.getByRole('textbox', {
      name: 'Rentabilidade esperada de Emergência',
    });
    await user.clear(field);
    await user.type(field, '150');

    const bar = screen.getByRole('region', { name: 'Salvar plano' });
    expect(within(bar).getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });
});

describe('PRJ-09 · acessibilidade da Projeção nos dois temas', () => {
  it.each(['light', 'dark'])('sem violação AA (tema %s)', async (theme) => {
    document.documentElement.dataset['theme'] = theme;
    const { container } = show();
    await screen.findByText('Projeção · Todas as carteiras');
    const found = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(found.violations.map((v) => v.id)).toEqual([]);
  });
});
