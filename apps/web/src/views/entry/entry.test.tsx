import type { SearchResource, TransactionPreviewResource } from '@patrimonio/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import { Modal } from '../../components/overlay.js';
import type { EntryReference } from '../../lib/entry.js';
import { TradeFormView } from './trade_form.js';

vi.mock('../../api/entry.js', () => ({
  previewTransaction: vi.fn(),
  createTransaction: vi.fn(),
}));

const api = await import('../../api/entry.js');
const previewTransaction = vi.mocked(api.previewTransaction);
const createTransaction = vi.mocked(api.createTransaction);

const PORTFOLIO = '11111111-1111-4111-8111-111111111111';
const INSTITUTION = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';

const reference: EntryReference = {
  portfolios: [{ id: PORTFOLIO, name: 'Longo prazo' }],
  institutions: [{ id: INSTITUTION, name: 'XP' }],
};

const pair = (before: string, after: string) => ({ before, after });

const preview: TransactionPreviewResource = {
  basis: 'cost',
  total_amount: '3104.00',
  net_amount: '-3104.00',
  position: {
    quantity: pair('500', '600'),
    avg_price: pair('30.00', '30.17'),
    cost_basis: pair('15000.00', '18104.00'),
    weight_pct: pair('0.10', '0.12'),
  },
  cash: pair('0', '0'),
  portfolio_cost_basis: pair('100000.00', '103104.00'),
  allocation: null,
  realized_result: null,
  oversold: false,
};

/** Uma busca que sempre acha o mesmo ativo: a rede não entra no teste. */
const search = vi.fn(
  async (): Promise<SearchResource> =>
    ({
      assets: {
        items: [
          {
            id: ASSET,
            ticker: 'ITUB4',
            name: 'Itaú Unibanco',
            b3_type: 'stock',
            holding: { quantity: '500' },
          },
        ],
      },
    }) as unknown as SearchResource,
);

const onSaved = vi.fn();
const onCancel = vi.fn();

const show = (kind: 'buy' | 'sell' = 'buy') =>
  render(
    <PreferencesProvider>
      <ShortcutProvider>
        <Modal title="Novo lançamento" open onClose={onCancel}>
          <TradeFormView
            kind={kind}
            reference={reference}
            seed={{
              asset: { id: ASSET, label: 'ITUB4', name: 'Itaú Unibanco', held: '500' },
              portfolioId: PORTFOLIO,
              institutionId: INSTITUTION,
              date: '2026-10-10',
            }}
            search={search}
            onSaved={onSaved}
            onCancel={onCancel}
          />
        </Modal>
      </ShortcutProvider>
    </PreferencesProvider>,
  );

beforeEach(() => {
  previewTransaction.mockResolvedValue(preview);
  createTransaction.mockResolvedValue({
    message: 'Compra lançada.',
    queued: true,
    transaction: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('lançamento de compra e venda', () => {
  it('mostra o antes → depois que a api calculou, sem aproximar na tela', async () => {
    const user = userEvent.setup();
    show();

    await user.type(screen.getByLabelText('Quantidade'), '100');
    await user.type(screen.getByLabelText('Preço unitário'), '31,04');

    await waitFor(() => expect(previewTransaction).toHaveBeenCalled());
    const body = previewTransaction.mock.calls.at(-1)?.[0];
    expect(body).toMatchObject({ kind: 'buy', quantity: '100', unit_price: '31.04' });

    // O que a tela escreve é o que a api devolveu.
    expect(await screen.findByText('Preço médio')).toBeInTheDocument();
    expect(screen.getByText('% da carteira')).toBeInTheDocument();
  });

  it('⌘↵ salva uma vez, mesmo apertado duas', async () => {
    const user = userEvent.setup();
    show();

    await user.type(screen.getByLabelText('Quantidade'), '100');
    await user.type(screen.getByLabelText('Preço unitário'), '31,04');
    // A gravação demora o bastante para o segundo ⌘↵ chegar com ela em andamento.
    createTransaction.mockImplementationOnce(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({ message: 'Compra lançada.', queued: true, transaction: null }),
            80,
          ),
        ),
    );
    await user.keyboard('{Meta>}{Enter}{Enter}{/Meta}');

    await waitFor(() => expect(createTransaction).toHaveBeenCalled());
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect(createTransaction.mock.calls[0]?.[1]).toEqual(expect.any(String));
  });

  it('campo inválido bloqueia o salvar e explica o erro no próprio campo', async () => {
    const user = userEvent.setup();
    show();

    await user.type(screen.getByLabelText('Quantidade'), '100');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    const price = screen.getByLabelText('Preço unitário');
    expect(createTransaction).not.toHaveBeenCalled();
    expect(price).toHaveAttribute('aria-invalid', 'true');

    const describedBy = price.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(
      'Informe o preço.',
    );
  });

  it('venda acima da posição é recusada pela api e aparece no campo da quantidade', async () => {
    const user = userEvent.setup();
    previewTransaction.mockRejectedValue(
      new Error('Não há quantidade suficiente para vender'),
    );
    show('sell');

    await user.type(screen.getByLabelText('Quantidade'), '900');
    await user.type(screen.getByLabelText('Preço unitário'), '31,04');

    const quantity = screen.getByLabelText('Quantidade');
    await waitFor(() => expect(quantity).toHaveAttribute('aria-invalid', 'true'));
    expect(
      document.getElementById(quantity.getAttribute('aria-describedby') ?? ''),
    ).toHaveTextContent('Não há quantidade suficiente');
  });

  it('Esc fecha e descarta sem gravar', async () => {
    const user = userEvent.setup();
    show();

    await user.type(screen.getByLabelText('Quantidade'), '100');
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalled();
    expect(createTransaction).not.toHaveBeenCalled();
  });
});
