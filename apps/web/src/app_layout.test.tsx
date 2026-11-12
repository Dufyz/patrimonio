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
  return <output aria-label="caminho">{`${location.pathname}${location.search}`}</output>;
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

describe('NAV-04 · trocar de carteira mantém a tela', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    // A barra lateral só mostra os nomes em janela larga.
    globalThis.innerWidth = 1440;
  });

  it('trocar de carteira mantém a tela', async () => {
    const user = await open('/carteiras/longo-prazo/posicoes');

    await user.click(within(nav()).getByRole('button', { name: /Reserva/u }));

    await waitFor(() => expect(path()).toBe('/carteiras/reserva/posicoes'));
    expect(current()).toEqual(['Reserva', 'Posições']);
  });

  it('em Todas, Estratégia não existe; vir de Estratégia abre a Visão geral do novo escopo', async () => {
    const user = await open('/carteiras/longo-prazo/estrategia');

    await user.click(within(nav()).getByRole('button', { name: /Todas as carteiras/u }));

    await waitFor(() => expect(path()).toBe('/?escopo=investimentos'));
    const titles = within(nav())
      .getAllByRole('button')
      .map((button) => button.getAttribute('title'));
    expect(titles).toContain('Objetivos');
    expect(titles).not.toContain('Estratégia');
  });

  it('em uma carteira o objetivo é singular e Estratégia aparece', async () => {
    await open('/carteiras/longo-prazo/posicoes');

    const titles = within(nav())
      .getAllByRole('button')
      .map((button) => button.getAttribute('title'));
    expect(titles).toContain('Objetivo');
    expect(titles).toContain('Estratégia');
    expect(titles).toContain('Projeção');
  });

  it('a barra não lista Visão geral nem Movimentações dentro do grupo de carteiras', async () => {
    await open('/carteiras/longo-prazo/posicoes');

    const titles = within(nav())
      .getAllByRole('button')
      .map((button) => button.getAttribute('title'));
    expect(titles.filter((title) => title === 'Visão geral')).toHaveLength(1);
    expect(titles).not.toContain('Movimentações');
  });

  it('a página do ativo mantém Posições destacada, e trocar de carteira abre Posições', async () => {
    const user = await open('/carteiras/longo-prazo/ativos/itub4');
    expect(current()).toEqual(['Longo prazo', 'Posições']);

    await user.click(within(nav()).getByRole('button', { name: /Reserva/u }));

    await waitFor(() => expect(path()).toBe('/carteiras/reserva/posicoes'));
  });

  it('a Visão geral de Investimentos destaca a carteira e a Visão geral', async () => {
    await open('/?escopo=investimentos&carteira=longo-prazo');

    expect(current()).toEqual(['Visão geral', 'Longo prazo']);
  });

  it('numa tela de fluxo nenhuma carteira fica destacada', async () => {
    await open('/cartoes/abc');

    expect(current()).toEqual(['Cartões']);
  });

  it('numa tela de fluxo, clicar numa carteira abre a Visão geral de Investimentos dela', async () => {
    const user = await open('/contas');

    await user.click(within(nav()).getByRole('button', { name: /Reserva/u }));

    await waitFor(() => expect(path()).toBe('/?escopo=investimentos&carteira=reserva'));
  });

  it('Configurações é global e destaca só ela', async () => {
    const user = await open('/carteiras/longo-prazo/posicoes');

    await user.click(within(nav()).getByRole('button', { name: 'Configurações' }));

    await waitFor(() => expect(path()).toBe('/configuracoes'));
    expect(current()).toEqual(['Configurações']);
  });

  it('guarda a última carteira aberta', async () => {
    await open('/carteiras/longo-prazo/posicoes');

    await waitFor(() =>
      expect(globalThis.localStorage.getItem('patrimonio.last-scope')).toBe(
        'longo-prazo',
      ),
    );
  });
});

describe('NAV-02 e NAV-11 · busca e atalhos', () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.innerWidth = 1440;
  });

  it('G V leva à Visão geral de qualquer tela', async () => {
    const user = await open('/carteiras/longo-prazo/posicoes');

    await user.keyboard('gv');

    await waitFor(() => expect(path()).toBe('/'));
  });

  it('⌘K abre a busca global em qualquer tela e leva à tela escolhida', async () => {
    const user = await open('/');

    await user.keyboard('{Meta>}k{/Meta}');
    const campo = await screen.findByRole('combobox', { name: /Buscar/u });
    await user.type(campo, 'cartoes');
    const telas = await screen.findByRole('region', { name: 'Telas · Finanças' });
    await user.click(within(telas).getByRole('option', { name: /Cartões/u }));

    await waitFor(() => expect(path()).toBe('/cartoes'));
  });

  it('a busca chega às telas de carteira a partir de uma tela de fluxo', async () => {
    const user = await open('/contas');

    await user.keyboard('{Meta>}k{/Meta}');
    await user.type(await screen.findByRole('combobox', { name: /Buscar/u }), 'posicoes');
    await user.click(await screen.findByRole('option', { name: /Posições/u }));

    await waitFor(() => expect(path()).toBe('/carteiras/todas/posicoes'));
  });

  it('acha lançamentos de Finanças e abre a tela deles', async () => {
    const description = store.get().entries.find((entry) => entry.historical !== true)
      ?.description as string;
    const user = await open('/?escopo=investimentos');

    await user.keyboard('{Meta>}k{/Meta}');
    await user.type(
      await screen.findByRole('combobox', { name: /Buscar/u }),
      description,
    );
    const busca = await screen.findByRole('dialog', { name: 'Busca global' });
    const grupo = await within(busca).findByRole('region', { name: 'Finanças' });
    await user.click(within(grupo).getAllByRole('option')[0] as HTMLElement);

    await waitFor(() => expect(path()).toMatch(/^\/lancamentos/u));
  });

  it('o botão de buscar da barra abre a mesma busca', async () => {
    const user = await open('/');

    await user.click(within(nav()).getByRole('button', { name: /Buscar/u }));

    expect(
      await screen.findByRole('dialog', { name: 'Busca global' }),
    ).toBeInTheDocument();
  });
});
