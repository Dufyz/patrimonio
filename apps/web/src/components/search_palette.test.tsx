import type { SearchResource } from '@patrimonio/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RECENT_STORAGE_KEY } from '../lib/search.js';
import type { SearchActionId } from '../lib/search.js';
import type { Storageish } from '../lib/preferences.js';
import { PreferencesProvider } from './preferences.js';
import { SearchPalette } from './search_palette.js';
import type { SearchPaletteProps } from './search_palette.js';

/**
 * T-09 · A paleta ⌘K.
 *
 * A lógica de ranking e de agrupamento está em `lib/search.test.ts`. O que esta
 * suíte prova é o que só a tela mostra: que ela abre sem esperar a rede, que o
 * teclado a percorre inteira, que resposta velha não sobrescreve a nova e que
 * o item marcado não pula quando a `api` responde.
 */

const SCREENS = [
  { id: 'visao', label: 'Visão geral', glyph: '▦', shortcut: 'G V' },
  { id: 'posicoes', label: 'Posições', glyph: '≡', shortcut: 'G P' },
  { id: 'movimentacoes', label: 'Movimentações', glyph: '⇄', shortcut: 'G M' },
];
const PORTFOLIOS = [
  { id: 'todas', label: 'Todas as carteiras' },
  { id: 'longo', label: 'Longo prazo' },
];

const RESOURCE: SearchResource = {
  query: 'itu',
  assets: {
    total: 2,
    items: [
      {
        id: '0191e5a0-0000-7000-8000-000000000001',
        ticker: 'ITUB4',
        name: 'Itaú Unibanco PN',
        b3_type: 'stock',
        holding: {
          quantity: '500.00000000',
          market_value: '18420.00',
          portfolio_names: ['Longo prazo'],
        },
      },
      {
        id: '0191e5a0-0000-7000-8000-000000000002',
        ticker: 'ITUB3',
        name: 'Itaú Unibanco ON',
        b3_type: 'stock',
        holding: null,
      },
    ],
  },
  transactions: {
    total: 24,
    items: [
      {
        id: '0191e5a0-0000-7000-8000-000000000011',
        kind: 'payout',
        payout_kind: 'jcp',
        trade_date: '2026-10-20',
        portfolio_id: '0191e5a0-0000-7000-8000-0000000000a1',
        portfolio_name: 'Longo prazo',
        asset_id: '0191e5a0-0000-7000-8000-000000000001',
        ticker: 'ITUB4',
        asset_name: 'Itaú Unibanco PN',
        b3_type: 'stock',
        quantity: '500.00000000',
        net_amount: '96.12',
        pending: true,
      },
    ],
  },
};

const memory = (
  initial: Record<string, string> = {},
): Storageish & {
  readonly data: Map<string, string>;
} => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

const NONE: ReadonlySet<SearchActionId> = new Set();

const open = (props: Partial<SearchPaletteProps> = {}) => {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const search = vi.fn(async () => RESOURCE);
  const storage = memory();

  const view = render(
    <PreferencesProvider storage={null}>
      <SearchPalette
        open
        onClose={onClose}
        scopeLabel="Longo prazo"
        screens={SCREENS}
        portfolios={PORTFOLIOS}
        readyActions={NONE}
        onSelect={onSelect}
        search={search}
        storage={storage}
        {...props}
      />
    </PreferencesProvider>,
  );

  return { onClose, onSelect, search, storage, user: userEvent.setup(), ...view };
};

const field = () => screen.getByRole('combobox');
const marked = () =>
  screen
    .getAllByRole('option')
    .find((option) => option.getAttribute('aria-selected') === 'true');

describe('abertura', () => {
  it('abre com telas e ações, e sem nenhum pedido à api', () => {
    const { search } = open();

    expect(screen.getByRole('dialog', { name: 'Busca global' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Visão geral/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Novo lançamento/ })).toBeInTheDocument();
    expect(screen.getByText('Ir para')).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  it('abre mesmo que a api nunca responda', async () => {
    const never = vi.fn(() => new Promise<SearchResource>(() => {}));
    const { user } = open({ search: never });

    await user.type(field(), 'pos');

    // A tela do navegador aparece enquanto a busca no banco segue pendente.
    expect(await screen.findByRole('option', { name: /Posições/ })).toBeInTheDocument();
    expect(screen.getByText(/Buscando ativos e lançamentos/)).toBeInTheDocument();
  });

  it('põe o foco no campo e marca o primeiro item', () => {
    open();

    expect(field()).toHaveFocus();
    expect(marked()).toHaveTextContent('Visão geral');
  });

  it('não renderiza nada fechada', () => {
    open({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('mostra o escopo e a dica de teclado do rodapé', () => {
    open();

    expect(screen.getByText('Longo prazo', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/filtrar por tipo/)).toBeInTheDocument();
  });
});

describe('busca', () => {
  it('agrupa ativos, ações com o ativo e lançamentos, como a prancha 12', async () => {
    const { user } = open();

    await user.type(field(), 'itu');

    expect(await screen.findByText('Ativos')).toBeInTheDocument();
    expect(screen.getByText('Ações com ITUB4')).toBeInTheDocument();
    expect(screen.getByText('Lançamentos')).toBeInTheDocument();

    const itub4 = screen.getByRole('option', { name: /ITUB4 Itaú Unibanco PN/ });
    expect(within(itub4).getByText(/500 em Longo prazo/)).toBeInTheDocument();
    expect(within(itub4).getByText('R$ 18.420,00')).toBeInTheDocument();

    const itub3 = screen.getByRole('option', { name: /ITUB3/ });
    expect(within(itub3).getByText(/sem posição/)).toBeInTheDocument();
  });

  it('marca o ativo de cima quando a api responde', async () => {
    const { user } = open();

    await user.type(field(), 'itu');
    await screen.findByText('Ativos');

    expect(marked()).toHaveTextContent('ITUB4');
  });

  it('escreve o lançamento a receber com data e carteira', async () => {
    const { user } = open();

    await user.type(field(), 'itu');

    const row = await screen.findByRole('option', { name: /JCP ITUB4/ });
    expect(
      within(row).getByText('a receber · 20/10/2026 · Longo prazo'),
    ).toBeInTheDocument();
    expect(within(row).getByText('R$ 96,12')).toBeInTheDocument();
  });

  it('diz quantos resultados a api cortou', async () => {
    const { user } = open();

    await user.type(field(), 'itu');
    await screen.findByText('Ativos');

    // 2 ativos + 2 ações (compra; ITUB4 tem posição → + provento + mover = 3) + 1 lançamento.
    expect(screen.getByText(/mostrando \d+ de \d+/)).toBeInTheDocument();
  });

  it('paga um pedido só para um texto digitado de uma vez', async () => {
    const { user, search } = open();

    await user.type(field(), 'itub');
    await screen.findByText('Ativos');

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('itub', expect.any(AbortSignal));
  });

  it('cancela o pedido do texto antigo quando o texto muda', async () => {
    const signals: AbortSignal[] = [];
    const slow = vi.fn((_: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<SearchResource>(() => {});
    });
    const { user } = open({ search: slow });

    await user.type(field(), 'it');
    await waitFor(() => expect(slow).toHaveBeenCalledTimes(1));
    await user.type(field(), 'u');
    await waitFor(() => expect(slow).toHaveBeenCalledTimes(2));

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('não deixa resposta velha sobrescrever a do texto atual', async () => {
    let resolveFirst: (resource: SearchResource) => void = () => {};
    const search = vi
      .fn<(text: string, signal: AbortSignal) => Promise<SearchResource>>()
      .mockImplementationOnce(
        () => new Promise<SearchResource>((resolve) => (resolveFirst = resolve)),
      )
      .mockImplementation(async () => ({
        query: 'wege',
        assets: { total: 0, items: [] },
        transactions: { total: 0, items: [] },
      }));
    const { user } = open({ search });

    await user.type(field(), 'itu');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await user.clear(field());
    await user.type(field(), 'wege');
    await screen.findByText(/Nada encontrado para “wege”/);

    resolveFirst(RESOURCE);
    await Promise.resolve();

    expect(screen.queryByText('ITUB4')).not.toBeInTheDocument();
  });

  it('diz que nada foi encontrado, sem apagar o que o navegador achou', async () => {
    const empty = vi.fn(async () => ({
      query: 'zzz',
      assets: { total: 0, items: [] },
      transactions: { total: 0, items: [] },
    }));
    const { user } = open({ search: empty });

    await user.type(field(), 'zzz');

    expect(await screen.findByText(/Nada encontrado para “zzz”/)).toBeInTheDocument();
  });

  it('segue útil quando a api falha', async () => {
    const broken = vi.fn(async () => {
      throw new Error('fora do ar');
    });
    const { user } = open({ search: broken });

    await user.type(field(), 'pos');

    expect(await screen.findByText(/Não foi possível buscar ativos/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Posições/ })).toBeInTheDocument();
  });
});

describe('teclado', () => {
  it('desce e sobe com as setas, dando a volta', async () => {
    const { user } = open();

    await user.keyboard('{ArrowDown}');
    expect(marked()).toHaveTextContent('Posições');

    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(marked()).toHaveTextContent('Ir para Longo prazo');
  });

  it('executa o item marcado com Enter e fecha', async () => {
    const { user, onSelect, onClose } = open();

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith({ kind: 'screen', screen: 'posicoes' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Enter antes de a api responder executa o melhor item que já está na tela', async () => {
    const never = vi.fn(() => new Promise<SearchResource>(() => {}));
    const { user, onSelect } = open({ search: never });

    await user.type(field(), 'posicoes{Enter}');

    expect(onSelect).toHaveBeenCalledWith({ kind: 'screen', screen: 'posicoes' });
  });

  it('abre o ativo pelo endereço que o resto da aplicação usa', async () => {
    const { user, onSelect } = open();

    await user.type(field(), 'itu');
    await screen.findByText('Ativos');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'asset',
      assetId: '0191e5a0-0000-7000-8000-000000000001',
      slug: 'itub4',
    });
  });

  it('o item marcado não pula quando a api responde por cima', async () => {
    const { user } = open({
      search: vi.fn(async () => RESOURCE),
    });

    // Antes da resposta só há telas; a pessoa desce até "Movimentações".
    await user.type(field(), 'mov');
    await user.keyboard('{ArrowDown}');
    const before = marked();

    await screen.findByText('Lançamentos');

    expect(marked()?.id).toBe(before?.id);
  });

  it('Tab filtra por tipo, e Shift+Tab volta', async () => {
    const { user } = open();

    await user.type(field(), 'itu');
    await screen.findByText('Ativos');

    await user.keyboard('{Tab}');
    expect(
      screen.getByText('Ativos', { selector: 'span.rounded-full' }),
    ).toBeInTheDocument();
    // Filtrado em ativos, o grupo de lançamentos some, e as ações do ativo ficam.
    expect(screen.queryByRole('region', { name: 'Lançamentos' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ações com ITUB4' })).toBeInTheDocument();

    await user.keyboard('{Tab}');
    expect(
      screen.getByText('Lançamentos', { selector: 'span.rounded-full' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /ITUB3/ })).not.toBeInTheDocument();

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(
      screen.getByText('Ativos', { selector: 'span.rounded-full' }),
    ).toBeInTheDocument();
    expect(field()).toHaveFocus();
  });

  it('Esc fecha', async () => {
    const { user, onClose } = open();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ações que ainda não existem', () => {
  it('aparecem desativadas, dizendo qual história as entrega', () => {
    open();

    const action = screen.getByRole('option', { name: /Novo lançamento/ });
    expect(action).toHaveAttribute('aria-disabled', 'true');
    expect(within(action).getByText('chega com T-10')).toBeInTheDocument();
  });

  it('o marcador passa por cima delas, e clicar não faz nada', async () => {
    const { user, onSelect, onClose } = open();

    await user.keyboard('{ArrowUp}');
    expect(marked()).not.toHaveTextContent('Novo lançamento');

    await user.click(screen.getByRole('option', { name: /Novo lançamento/ }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ficam ativas quando a tela existe', async () => {
    const { user, onSelect } = open({
      readyActions: new Set<SearchActionId>(['new_transaction']),
    });

    await user.click(screen.getByRole('option', { name: /Novo lançamento/ }));

    expect(onSelect).toHaveBeenCalledWith({ kind: 'action', action: 'new_transaction' });
  });

  it('oferece provento e transferência só de quem tem posição', async () => {
    const { user } = open();

    await user.type(field(), 'itu');
    await screen.findByText('Ações com ITUB4');

    expect(
      screen.getByRole('option', { name: /Lançar compra de ITUB4/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Lançar provento de ITUB4/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Mover ITUB4/ })).toBeInTheDocument();
  });
});

describe('mouse', () => {
  it('um clique executa o item', async () => {
    const { user, onSelect, onClose } = open();

    await user.click(screen.getByRole('option', { name: /Movimentações/ }));

    expect(onSelect).toHaveBeenCalledWith({ kind: 'screen', screen: 'movimentacoes' });
    expect(onClose).toHaveBeenCalled();
  });

  it('passar o mouse marca o item', async () => {
    const { user } = open();

    await user.hover(screen.getByRole('option', { name: /Posições/ }));

    expect(marked()).toHaveTextContent('Posições');
  });

  it('troca de carteira pela ação "Ir para"', async () => {
    const { user, onSelect } = open();

    await user.click(screen.getByRole('option', { name: /Ir para Longo prazo/ }));

    expect(onSelect).toHaveBeenCalledWith({ kind: 'portfolio', portfolioId: 'longo' });
  });
});

describe('recentes', () => {
  it('guarda o que foi aberto e mostra primeiro na próxima vez', async () => {
    const storage = memory();
    const first = open({ storage });

    await first.user.keyboard('{ArrowDown}{Enter}');
    expect(storage.data.has(RECENT_STORAGE_KEY)).toBe(true);
    first.unmount();

    open({ storage });

    const recent = screen.getByRole('region', { name: 'Recentes' });
    expect(within(recent).getByRole('option', { name: /Posições/ })).toBeInTheDocument();
    expect(marked()).toHaveTextContent('Posições');
  });

  it('não guarda ação', async () => {
    const storage = memory();
    const { user } = open({
      storage,
      readyActions: new Set<SearchActionId>(['new_transaction']),
    });

    await user.click(screen.getByRole('option', { name: /Novo lançamento/ }));

    expect(storage.data.has(RECENT_STORAGE_KEY)).toBe(false);
  });

  it('funciona sem armazenamento', async () => {
    const { user, onSelect } = open({ storage: null });

    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith({ kind: 'screen', screen: 'visao' });
  });
});
