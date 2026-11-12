import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppLayout } from './app_layout.js';
import { PortfoliosProvider } from './components/portfolios_provider.js';
import { PreferencesProvider } from './components/preferences.js';
import { ShortcutProvider } from './components/shortcuts.js';
import { createFinanceStore } from './finance/store/finance_store.js';

vi.mock('./api/portfolios.js', () => ({
  fetchPortfolios: () =>
    Promise.resolve({
      portfolios: [
        { id: 'p-longo', name: 'Longo prazo' },
        { id: 'p-reserva', name: 'Reserva' },
      ],
      values: { 'p-longo': '140000', 'p-reserva': '55000' },
      total: '195000',
    }),
}));

vi.mock('./api/search.js', () => ({
  SEARCH_TEXT_MAX: 80,
  fetchSearch: () => new Promise(() => undefined),
}));

vi.mock('./api/market.js', () => ({
  fetchMarketHealth: () => new Promise(() => undefined),
}));

const Where = (): React.ReactElement => {
  const location = useLocation();
  return <output aria-label="caminho">{location.pathname}</output>;
};

const store = createFinanceStore(null);

const open = async (path: string) => {
  const user = userEvent.setup();
  render(
    <PreferencesProvider storage={null}>
      <ShortcutProvider>
        <PortfoliosProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route element={<AppLayout financeStore={store} />}>
                <Route path="*" element={<Where />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </PortfoliosProvider>
      </ShortcutProvider>
    </PreferencesProvider>,
  );
  await screen.findByRole('button', { name: /Longo prazo/u });
  return user;
};

const nav = (): HTMLElement => screen.getByRole('navigation');
const path = (): string => screen.getByLabelText('caminho').textContent ?? '';
const current = (): string[] =>
  within(nav())
    .getAllByRole('button')
    .filter((button) => button.hasAttribute('aria-current'))
    .map((button) => button.getAttribute('title') ?? '');

describe('NAV-004 · trocar de carteira e de área', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    // A barra lateral só mostra os nomes em janela larga.
    globalThis.innerWidth = 1440;
  });

  it('trocar de carteira mantém a tela', async () => {
    const user = await open('/investimentos/longo-prazo/posicoes');

    await user.click(within(nav()).getByRole('button', { name: /Reserva/u }));

    await waitFor(() => expect(path()).toBe('/investimentos/reserva/posicoes'));
    expect(current()).toEqual(['Reserva', 'Posições']);
  });

  it('em Todas, Estratégia não existe; vir de Estratégia cai na Visão geral', async () => {
    const user = await open('/investimentos/longo-prazo/estrategia');

    await user.click(within(nav()).getByRole('button', { name: /Todas as carteiras/u }));

    await waitFor(() => expect(path()).toBe('/investimentos/todas/visao-geral'));
    const titles = within(nav())
      .getAllByRole('button')
      .map((button) => button.getAttribute('title'));
    expect(titles).toContain('Objetivos');
    expect(titles).not.toContain('Estratégia');
  });

  it('em uma carteira o objetivo é singular e Estratégia aparece', async () => {
    await open('/investimentos/longo-prazo/visao-geral');

    const titles = within(nav())
      .getAllByRole('button')
      .map((button) => button.getAttribute('title'));
    expect(titles).toContain('Objetivo');
    expect(titles).toContain('Estratégia');
    expect(titles).toContain('Projeção');
  });

  it('a página do ativo mantém Posições destacada, e trocar de carteira abre Posições', async () => {
    const user = await open('/investimentos/longo-prazo/ativo/itub4');
    expect(current()).toEqual(['Longo prazo', 'Posições']);

    await user.click(within(nav()).getByRole('button', { name: /Reserva/u }));

    await waitFor(() => expect(path()).toBe('/investimentos/reserva/posicoes'));
  });

  it('em Finanças nenhuma carteira fica destacada', async () => {
    await open('/financas/cartoes/abc');

    expect(current()).toEqual(['Cartões']);
  });

  it('vindo de Finanças, uma carteira abre a última tela de Investimentos usada', async () => {
    globalThis.localStorage.setItem(
      'patrimonio.last-path.investimentos',
      '/investimentos/longo-prazo/movimentacoes',
    );
    const user = await open('/financas/contas');

    await user.click(within(nav()).getByRole('button', { name: /Reserva/u }));

    await waitFor(() => expect(path()).toBe('/investimentos/reserva/movimentacoes'));
  });

  it('Configurações é global e não destaca nenhuma área', async () => {
    const user = await open('/investimentos/longo-prazo/posicoes');

    await user.click(within(nav()).getByRole('button', { name: 'Configurações' }));

    await waitFor(() => expect(path()).toBe('/configuracoes'));
    expect(current()).toEqual(['Configurações']);
  });

  it('guarda a última tela de cada área', async () => {
    await open('/investimentos/longo-prazo/posicoes');

    await waitFor(() =>
      expect(globalThis.localStorage.getItem('patrimonio.last-path.investimentos')).toBe(
        '/investimentos/longo-prazo/posicoes',
      ),
    );
    expect(globalThis.localStorage.getItem('patrimonio.last-scope')).toBe('longo-prazo');
  });
});

describe('NAV-007 e NAV-008 · busca e atalhos de área', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.innerWidth = 1440;
  });

  it('G G, G F e G I levam a Geral, Finanças e Investimentos', async () => {
    const user = await open('/geral');

    await user.keyboard('gf');
    await waitFor(() => expect(path()).toBe('/financas/visao-geral'));

    await user.keyboard('gi');
    await waitFor(() => expect(path()).toBe('/investimentos/todas/visao-geral'));

    await user.keyboard('gg');
    await waitFor(() => expect(path()).toBe('/geral'));
  });

  it('G F volta à última tela de Finanças', async () => {
    globalThis.localStorage.setItem('patrimonio.last-path.financas', '/financas/contas');
    const user = await open('/geral');

    await user.keyboard('gf');

    await waitFor(() => expect(path()).toBe('/financas/contas'));
  });

  it('⌘K abre a busca global em qualquer área e leva à tela escolhida', async () => {
    const user = await open('/geral');

    await user.keyboard('{Meta>}k{/Meta}');
    const campo = await screen.findByRole('combobox', { name: /Buscar/u });
    await user.type(campo, 'cartoes');
    await user.click(await screen.findByRole('option', { name: /Cartões.*Finanças/u }));

    await waitFor(() => expect(path()).toBe('/financas/cartoes'));
  });

  it('a busca é a mesma em Finanças e chega às telas de Investimentos', async () => {
    const user = await open('/financas/contas');

    await user.keyboard('{Meta>}k{/Meta}');
    await user.type(await screen.findByRole('combobox', { name: /Buscar/u }), 'posicoes');
    await user.click(await screen.findByRole('option', { name: /Posições/u }));

    await waitFor(() => expect(path()).toBe('/investimentos/todas/posicoes'));
  });

  it('acha lançamentos de Finanças e abre a tela deles', async () => {
    const description = store.get().entries.find((entry) => entry.historical !== true)
      ?.description as string;
    const user = await open('/investimentos/todas/visao-geral');

    await user.keyboard('{Meta>}k{/Meta}');
    await user.type(
      await screen.findByRole('combobox', { name: /Buscar/u }),
      description,
    );
    const busca = await screen.findByRole('dialog', { name: 'Busca global' });
    const grupo = await within(busca).findByRole('region', { name: 'Finanças' });
    await user.click(within(grupo).getAllByRole('option')[0] as HTMLElement);

    await waitFor(() => expect(path()).toBe('/financas/lancamentos'));
  });

  it('o botão de buscar da barra abre a mesma busca', async () => {
    const user = await open('/geral');

    await user.click(within(nav()).getByRole('button', { name: /Buscar/u }));

    expect(
      await screen.findByRole('dialog', { name: 'Busca global' }),
    ).toBeInTheDocument();
  });
});
