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
const CORRETORA = '0191e5a0-0000-7000-8000-00000000e101';
const BANCO = '0191e5a0-0000-7000-8000-00000000e102';
const TESOURO = '0191e5a0-0000-7000-8000-00000000e103';
const RF = '0191e5a0-0000-7000-8000-00000000e201';
const POS = '0191e5a0-0000-7000-8000-00000000e202';
const ACOES = '0191e5a0-0000-7000-8000-00000000e205';

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
  alerts: [
    { kind: 'price_stale', enabled: true, scope: 'global', threshold: { days: 3 } },
    { kind: 'corporate_event_pending', enabled: true, scope: 'global', threshold: null },
  ],
  categories: [
    {
      id: RF,
      parent_id: null,
      name: 'Renda fixa',
      color_token: 'class.rf',
      auto_rule: null,
      sort_order: 1,
      assets: 16,
      strategies: 4,
      children: 1,
    },
    {
      id: POS,
      parent_id: RF,
      name: 'Pós-fixada',
      color_token: 'class.rf_pos',
      auto_rule: { indexer: 'cdi_pct' },
      sort_order: 2,
      assets: 16,
      strategies: 3,
      children: 0,
    },
    {
      id: ACOES,
      parent_id: null,
      name: 'Ações',
      color_token: 'class.acoes',
      auto_rule: { b3_type: 'stock' },
      sort_order: 3,
      assets: 0,
      strategies: 0,
      children: 0,
    },
  ],
  institutions: [
    {
      id: CORRETORA,
      name: 'Corretora A',
      country: 'BR',
      portfolios: ['Longo prazo', 'Entrada do imóvel'],
      cash: '7192.87',
      blocking: { transactions: 12, assets: 1 },
    },
    {
      id: BANCO,
      name: 'Banco B',
      country: 'BR',
      portfolios: ['Entrada do imóvel'],
      cash: '4120.08',
      blocking: { transactions: 3, assets: 2 },
    },
    {
      id: TESOURO,
      name: 'Tesouro Direto',
      country: 'BR',
      portfolios: [],
      cash: null,
      blocking: { transactions: 0, assets: 0 },
    },
  ],
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

const health: MarketHealth = {
  reference_date: '2026-10-07',
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
});

describe('SettingsView', () => {
  it('desenha as nove seções, na ordem da prancha', () => {
    montar();

    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);

    expect(titles).toEqual([
      'Carteiras',
      'Alertas',
      'Categorias de ativo',
      'Instituições',
      'Dados de mercado',
      'Lançamentos',
      'Exibição',
      'Dados e backup',
    ]);
  });

  it('a carteira com lançamentos mostra o que impede excluí-la, com a contagem', () => {
    montar();

    const carteiras = within(screen.getByRole('table', { name: 'Carteiras abertas' }));

    const longo = carteiras.getByRole('row', { name: /Longo prazo/ });
    expect(within(longo).getByText('41 lançamentos · 9 ativos')).toBeTruthy();

    const imovel = carteiras.getByRole('row', { name: /Entrada do imóvel/ });
    expect(within(imovel).getByText('nada: pode ser excluída')).toBeTruthy();
    expect(screen.getByText(/1 arquivada · Viagem 2024/)).toBeTruthy();
  });

  it('criar e editar cadastro ficam desabilitados até T-10', () => {
    montar();

    for (const name of [
      '+ Nova carteira',
      '+ Categoria',
      '+ Instituição',
    ]) {
      expect(
        (screen.getByRole('button', { name }) as HTMLButtonElement).disabled,
        name,
      ).toBe(true);
    }
    expect(
      (
        screen.getByRole('button', {
          name: /Editar a carteira Longo prazo/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('os alertas mostram o limite como a prancha escreve, e o interruptor é só leitura', () => {
    montar();

    const row = screen.getByRole('row', { name: /Preço atrasado/ });
    expect(within(row).getByText('3 dias')).toBeTruthy();

    const toggle = within(row).getByRole('switch') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.disabled).toBe(true);
  });

  it('o grupo de categorias soma o que há dentro, e a regra vira frase', () => {
    montar();

    const grupo = screen.getByRole('row', { name: /^Renda fixa/ });
    expect(within(grupo).getByText('16')).toBeTruthy();
    expect(within(grupo).getByText('4 carteiras')).toBeTruthy();
    expect(
      within(grupo).getByText('1 categoria dentro · 16 ativos · 4 estratégias'),
    ).toBeTruthy();

    expect(screen.getByText('Indexador CDI ou Selic')).toBeTruthy();
    expect(screen.getByText('Tipo B3: ação ou unit')).toBeTruthy();
  });

  it('a instituição mostra o país, as carteiras e o caixa', () => {
    montar();

    const row = within(screen.getByRole('row', { name: /Banco B/ }));
    expect(row.getByText('BR')).toBeTruthy();
    expect(row.getByText('Entrada do imóvel')).toBeTruthy();
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

    expect(screen.getByText('Backup desligado nesta instalação')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Fazer backup agora' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
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

  it('exportar, importar e apagar tudo ficam desabilitados até as histórias deles', () => {
    montar();

    for (const name of [
      'CSV por tabela',
      'JSON completo',
      'Importar arquivo',
      'Apagar',
    ]) {
      expect(
        (screen.getByRole('button', { name }) as HTMLButtonElement).disabled,
        name,
      ).toBe(true);
    }
  });

  it('instalação vazia diz como começar, e erro de leitura não vira tela vazia', () => {
    const { unmount } = montar({
      settings: {
        kind: 'ready',
        value: {
          ...settings,
          portfolios: [],
          categories: [],
          institutions: [],
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
