import type { MarketHealth, Settings } from '@patrimonio/contracts';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../components/preferences.js';
import type { Resource, ResourceState } from '../lib/use_resource.js';
import { SettingsView } from './settings/index.js';

const api = vi.hoisted(() => ({
  runBackup: vi.fn(),
  refreshMarket: vi.fn(),
}));

const registers = vi.hoisted(() => ({
  createPortfolio: vi.fn(),
  updatePortfolio: vi.fn(),
  deletePortfolio: vi.fn(),
}));

vi.mock('../api/registers.js', () => registers);
vi.mock('../api/settings.js', () => ({
  fetchSettings: vi.fn(),
  runBackup: api.runBackup,
}));
vi.mock('../api/market.js', () => ({
  fetchMarketHealth: vi.fn(),
  refreshMarket: api.refreshMarket,
}));

const LONGO = '0191e5a0-0000-7000-8000-00000000e001';
const IMOVEL = '0191e5a0-0000-7000-8000-00000000e002';

const settings: Settings = {
  portfolios: [
    {
      id: LONGO,
      name: 'Longo prazo',
      benchmark: { value: 'CDI', name: 'CDI' },
      strategy_categories: 5,
      goals: ['Independência financeira'],
      blocking: { transactions: 41, assets: 9 },
    },
    {
      id: IMOVEL,
      name: 'Entrada do imóvel',
      benchmark: null,
      strategy_categories: 0,
      goals: [],
      blocking: { transactions: 0, assets: 0 },
    },
  ],
  archived_portfolios: [{ id: 'a', name: 'Viagem 2024', archived_on: '2026-03-04' }],
  ledger_defaults: {
    undo_window_seconds: 8,
    jcp_withholding_pct: '15',
    settlement: [
      { label: 'Ações e FIIs', business_days: 2 },
      { label: 'Tesouro', business_days: 1 },
      { label: 'RF bancária', business_days: 0 },
    ],
    editable: false,
  },
  backup: {
    enabled: true,
    last_success_at: '2026-10-08T06:01:00Z',
    last_failure: null,
    pending: false,
  },
};

const catalog = (
  key: MarketHealth['catalogs'][number]['key'],
  total: number,
): MarketHealth['catalogs'][number] => ({
  key,
  total,
  last_loaded: total === 0 ? null : '2026-10-07T18:00:00Z',
  state: total === 0 ? 'pending' : 'loaded',
});

const health: MarketHealth = {
  reference_date: '2026-10-07',
  catalogs: [
    catalog('institutions', 312),
    catalog('instruments', 1840),
    catalog('treasury', 0),
    catalog('indices', 5200),
    catalog('price_history', 0),
  ],
  demo: { portfolios: 0, assets: 0, institutions: 0 },
  sources: [
    {
      source: 'brapi',
      kind: 'quotes',
      status: 'ok',
      last_run: {
        id: 'r1',
        source: 'brapi',
        kind: 'quotes',
        reference_date: '2026-10-07',
        started_at: '2026-10-07T18:00:00Z',
        finished_at: '2026-10-07T18:02:00Z',
        ok: true,
        source_kind: 'primary',
        requests: 3,
        items: 24,
        missing: 2,
        error: null,
        detail: null,
      },
      coverage: { items: 24, missing: 2 },
      budget: {
        used: 40,
        ceiling: 15000,
        remaining: 14960,
        warning: false,
        exceeded: false,
      },
    },
  ],
  recent_failures: [
    {
      id: 'r0',
      source: 'brapi',
      kind: 'quotes',
      reference_date: '2026-10-04',
      started_at: '2026-10-04T18:00:00Z',
      finished_at: '2026-10-04T18:00:09Z',
      ok: false,
      source_kind: null,
      requests: 1,
      items: 0,
      missing: 0,
      error: 'brapi respondeu 503',
      detail: null,
    },
  ],
  missing_prices: [{ asset_id: 'k', ticker: 'KNRI11', last_price_date: '2026-10-04' }],
};

const resource = <T,>(
  state: ResourceState<T>,
  reload: () => void = vi.fn(),
): Resource<T> => ({
  state,
  pending: false,
  reload,
});

const montar = (
  options: {
    readonly settings?: ResourceState<Settings>;
    readonly market?: ResourceState<MarketHealth>;
    readonly reload?: () => void;
  } = {},
) =>
  render(
    <PreferencesProvider storage={null}>
      <SettingsView
        settings={resource(
          options.settings ?? { kind: 'ready', value: settings },
          options.reload,
        )}
        market={resource(options.market ?? { kind: 'ready', value: health })}
        section="carteiras"
        onSection={vi.fn()}
      />
    </PreferencesProvider>,
  );

beforeEach(() => {
  api.runBackup.mockReset();
  api.refreshMarket.mockReset();
  for (const mock of Object.values(registers)) mock.mockReset();
});

describe('SettingsView', () => {
  it('desenha as quatro seções, na ordem da prancha', () => {
    montar();

    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);

    expect(titles).toEqual([
      'Carteiras',
      'Dados de mercado',
      'Exibição',
      'Dados e backup',
    ]);
  });

  it('a carteira mostra o conteúdo que será excluído com ela, sem benchmark nem objetivo', () => {
    montar();

    const carteiras = within(screen.getByRole('table', { name: 'Carteiras abertas' }));

    const longo = carteiras.getByRole('row', { name: /Longo prazo/ });
    expect(within(longo).getByText('41 lançamentos · 9 ativos')).toBeTruthy();

    const imovel = carteiras.getByRole('row', { name: /Entrada do imóvel/ });
    expect(within(imovel).getByText('vazia')).toBeTruthy();
    expect(carteiras.queryByRole('columnheader', { name: 'Benchmark' })).toBeNull();
    expect(carteiras.queryByRole('columnheader', { name: 'Objetivo' })).toBeNull();
    expect(screen.getByText(/1 arquivada · Viagem 2024/)).toBeTruthy();
  });

  it('criar carteira abre o modal e grava só o nome, sem campo de benchmark', async () => {
    const user = userEvent.setup();
    registers.createPortfolio.mockResolvedValue({});
    montar();

    await user.click(screen.getByRole('button', { name: 'Nova carteira' }));
    const dialog = screen.getByRole('dialog', { name: 'Nova carteira' });

    await user.type(within(dialog).getByLabelText('Nome'), 'Viagem 2027');
    expect(within(dialog).queryByLabelText('Benchmark')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: /Salvar/ }));

    expect(registers.createPortfolio).toHaveBeenCalledWith({ name: 'Viagem 2027' });
  });

  it('carteira sem nome não é enviada, e o erro aparece no campo', async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole('button', { name: 'Nova carteira' }));
    const dialog = screen.getByRole('dialog', { name: 'Nova carteira' });
    await user.click(within(dialog).getByRole('button', { name: /Salvar/ }));

    expect(within(dialog).getByText('Dê um nome à carteira.')).toBeTruthy();
    expect(registers.createPortfolio).not.toHaveBeenCalled();
  });

  it('excluir carteira com lançamentos exclui tudo, depois do aviso e de dois checks', async () => {
    const user = userEvent.setup();
    registers.deletePortfolio.mockResolvedValue({});
    montar();

    await user.click(
      screen.getByRole('button', { name: 'Editar a carteira Longo prazo' }),
    );
    await user.click(screen.getByRole('button', { name: /Excluir carteira/ }));

    const dialog = screen.getByRole('dialog', { name: /Excluir Longo prazo\?/ });
    expect(within(dialog).getByText(/tudo será apagado junto/)).toBeTruthy();
    expect(within(dialog).getByText(/41 lançamentos, 9 ativos/)).toBeTruthy();
    expect(within(dialog).queryByRole('radio')).toBeNull();

    const confirm = within(dialog).getByRole('button', {
      name: 'Excluir carteira e tudo nela',
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    // Só o nome não basta...
    await user.type(within(dialog).getByLabelText(/Digite Longo prazo/), 'Longo prazo');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    // ...nem só o aceite: os dois juntos destravam o botão.
    await user.click(within(dialog).getByRole('checkbox', { name: /Entendo/ }));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirm);
    await user.click(await screen.findByRole('button', { name: 'Sim, excluir' }));

    expect(registers.deletePortfolio).toHaveBeenCalledWith(LONGO, {
      confirm_name: 'Longo prazo',
      transactions: 'delete',
    });
  });

  it('dados de mercado mostram cobertura, falha com a mensagem e os papéis sem preço', () => {
    montar();

    const row = screen.getByRole('row', { name: /Cotações/ });
    expect(within(row).getByText('22 / 24')).toBeTruthy();
    expect(within(row).getByText('2 sem preço')).toBeTruthy();

    expect(screen.getByText('brapi respondeu 503')).toBeTruthy();
    expect(screen.getByText(/KNRI11 sem cotação do dia/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Definir preço de KNRI11' })).toBeTruthy();
  });

  it('cada catálogo mostra contagem e estado, e o vazio diz o comando que o preenche', () => {
    montar();

    const table = within(
      screen.getByRole('table', { name: 'Catálogos da carga inicial' }),
    );

    const instruments = table.getByRole('row', { name: /Instrumentos listados/ });
    expect(within(instruments).getByText('1840')).toBeTruthy();
    expect(within(instruments).getByText('carregado')).toBeTruthy();

    const treasury = table.getByRole('row', { name: /Tesouro Direto/ });
    expect(within(treasury).getByText('pnpm seed:tesouro')).toBeTruthy();
    expect(within(treasury).getByText(/pendente/)).toBeTruthy();

    const history = table.getByRole('row', { name: /Histórico de preços/ });
    expect(within(history).getByText('pnpm seed:cotahist')).toBeTruthy();
  });

  it('sem dado de demonstração, não há aviso', () => {
    montar();

    expect(screen.queryByText('Dados de demonstração')).toBeNull();
  });

  it('com dado de demonstração, o aviso diz o quê e como remover', () => {
    montar({
      market: {
        kind: 'ready',
        value: { ...health, demo: { portfolios: 4, assets: 37, institutions: 8 } },
      },
    });

    expect(screen.getByText('Dados de demonstração')).toBeTruthy();
    expect(screen.getByText(/4 carteiras, 37 ativos, 8 instituições/)).toBeTruthy();
    expect(screen.getByText('pnpm demo:remove')).toBeTruthy();
  });

  it('a leitura de mercado que falha não vira "nenhuma fonte": mostra o erro e deixa tentar de novo', () => {
    montar({ market: { kind: 'error', error: new Error('api fora do ar') } });

    expect(screen.getByRole('alert').textContent).toMatch(/api fora do ar/);
    expect(screen.queryByText('Nenhuma fonte registrou coleta ainda.')).toBeNull();
  });

  it('"Atualizar agora" pede a coleta, avisa e relê', async () => {
    api.refreshMarket.mockResolvedValue({ job_id: 'j', already_queued: false });
    montar();

    await userEvent.click(screen.getByRole('button', { name: /Atualizar agora/ }));

    expect(api.refreshMarket).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('status')).textContent).toMatch(/Coleta pedida/);
  });

  it('lançamentos mostra a regra de liquidação e o que vem da instalação, sem botão de salvar', () => {
    montar();

    expect(
      screen.getByText('Ações e FIIs D+2 · Tesouro D+1 · RF bancária D+0'),
    ).toBeTruthy();
    expect(screen.getByText('15%')).toBeTruthy();
    expect(screen.getByText('8 s')).toBeTruthy();
  });

  it('exibição troca o tema e a densidade sem recarregar', async () => {
    montar();

    await userEvent.click(screen.getByRole('radio', { name: 'Escuro' }));
    expect(
      screen.getByRole('radio', { name: 'Escuro' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(globalThis.document.documentElement.dataset['theme']).toBe('dark');

    await userEvent.click(screen.getByRole('radio', { name: 'Compacta' }));
    expect(
      screen.getByRole('radio', { name: 'Compacta' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('o backup mostra o último, pede um novo e diz que foi pedido', async () => {
    api.runBackup.mockResolvedValue({ job_id: 'j', already_queued: false });
    const reload = vi.fn();
    montar({ reload });

    expect(screen.getByText('Último backup em 08/10 03:01')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Fazer backup agora' }));

    expect(api.runBackup).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Backup pedido\. Ele aparece/)).toBeTruthy();
    expect(reload).toHaveBeenCalled();
  });

  it('backup desligado na instalação não oferece um botão que promete o que não vai existir', () => {
    montar({
      settings: {
        kind: 'ready',
        value: { ...settings, backup: { ...settings.backup, enabled: false } },
      },
    });

    // O motivo mora na dica do botão, e não num texto ao lado dele.
    expect(screen.queryByText('Backup desligado nesta instalação')).toBeNull();
    const button = screen.getByRole('button', {
      name: 'Fazer backup agora',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Backup desligado nesta instalação');
  });

  it('a falha do backup vem com a mensagem do erro', () => {
    montar({
      settings: {
        kind: 'ready',
        value: {
          ...settings,
          backup: {
            ...settings.backup,
            last_failure: {
              at: '2026-10-08T06:00:09Z',
              error: 'bucket recusou o upload',
            },
          },
        },
      },
    });

    expect(screen.getByText(/bucket recusou o upload/)).toBeTruthy();
  });

  it('importar, exportar e apagar estão de pé', () => {
    montar();

    for (const name of [
      'Importar arquivo',
      'CSV por tabela',
      'JSON completo',
      'Apagar',
    ]) {
      expect(
        (screen.getByRole('button', { name }) as HTMLButtonElement).disabled,
        name,
      ).toBe(false);
    }
  });

  it('apagar tudo só libera o botão com a frase inteira', async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole('button', { name: 'Apagar' }));
    const confirm = screen.getByRole('button', { name: 'Apagar tudo' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByPlaceholderText('APAGAR TUDO'), 'APAGAR TUDO');
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it('instalação vazia diz como começar, e erro de leitura não vira tela vazia', () => {
    const { unmount } = montar({
      settings: {
        kind: 'ready',
        value: {
          ...settings,
          portfolios: [],
          archived_portfolios: [],
        },
      },
    });
    expect(screen.getByText(/Nada cadastrado ainda/)).toBeTruthy();
    expect(screen.getByText(/Nenhuma carteira ainda/)).toBeTruthy();
    unmount();

    montar({ settings: { kind: 'error', error: new Error('api fora do ar') } });
    expect(screen.getByRole('alert').textContent).toMatch(/api fora do ar/);
    expect(screen.queryByRole('heading', { name: 'Carteiras' })).toBeNull();
  });
});
