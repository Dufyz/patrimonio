import type {
  CorporateEventPreviewResource,
  SearchResource,
} from '@patrimonio/contracts';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Modal } from '../../components/overlay.js';
import { PreferencesProvider } from '../../components/preferences.js';
import { ShortcutProvider } from '../../components/shortcuts.js';
import type { AssetSearch } from './asset_picker.js';
import { EventFormView } from './event_form.js';

vi.mock('../../api/entry.js', () => ({
  previewCorporateEvent: vi.fn(),
  applyCorporateEvent: vi.fn(),
}));

const api = await import('../../api/entry.js');
const previewCorporateEvent = vi.mocked(api.previewCorporateEvent);
const applyCorporateEvent = vi.mocked(api.applyCorporateEvent);

const ASSET = '33333333-3333-4333-8333-333333333333';
const PORTFOLIO = '11111111-1111-4111-8111-111111111111';

const preview: CorporateEventPreviewResource = {
  kind: 'corporate_event',
  record_date: '2026-06-10',
  portfolios: [
    {
      portfolio_id: PORTFOLIO,
      portfolio_name: 'Longo prazo',
      quantity: { before: '100', after: '200' },
      avg_price: { before: '30.00', after: '15.00' },
      cost_basis: { before: '3000.00', after: '3000.00' },
    },
  ],
};

const search: AssetSearch = vi.fn(
  async (): Promise<SearchResource> =>
    ({
      assets: { items: [] },
      instruments: { total: 0, items: [], fallback: 'none', catalog_empty: false },
    }) as unknown as SearchResource,
);

const onSaved = vi.fn();
const onCancel = vi.fn();

const show = () =>
  render(
    <PreferencesProvider>
      <ShortcutProvider>
        <Modal title="Novo lançamento" open onClose={onCancel}>
          <EventFormView
            seed={{
              asset: { id: ASSET, label: 'ITUB4', name: 'Itaú Unibanco', held: '100' },
              date: '2026-06-10',
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
  previewCorporateEvent.mockResolvedValue(preview);
  applyCorporateEvent.mockResolvedValue({
    message: 'Evento aplicado',
    queued: true,
    transaction: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('evento corporativo lançado à mão', () => {
  it('pede o preview com a razão do fator e mostra o efeito por carteira', async () => {
    const user = userEvent.setup();
    show();

    await user.type(screen.getByLabelText('Cada 1 papel vira'), '2');

    await waitFor(() => expect(previewCorporateEvent).toHaveBeenCalled());
    expect(previewCorporateEvent.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: 'corporate_event',
      event_kind: 'split',
      asset_id: ASSET,
      record_date: '2026-06-10',
      ratio_from: '1',
      ratio_to: '2',
    });

    expect(await screen.findByText('Custo total')).toBeInTheDocument();
    expect(screen.getByText('sem mudança')).toBeInTheDocument();
  });

  it('grupamento troca o rótulo do fator e inverte a razão', async () => {
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('radio', { name: 'Grupamento' }));
    await user.type(screen.getByLabelText('Cada … papéis viram 1'), '10');

    await waitFor(() => expect(previewCorporateEvent).toHaveBeenCalled());
    expect(previewCorporateEvent.mock.calls.at(-1)?.[0]).toMatchObject({
      event_kind: 'reverse_split',
      ratio_from: '10',
      ratio_to: '1',
    });
  });

  it('aplicar registra e confirma uma vez, e avisa o recálculo', async () => {
    const user = userEvent.setup();
    show();

    await user.type(screen.getByLabelText('Cada 1 papel vira'), '2');
    await user.click(screen.getByRole('button', { name: /Aplicar evento/ }));

    await waitFor(() => expect(applyCorporateEvent).toHaveBeenCalledTimes(1));
    expect(applyCorporateEvent.mock.calls[0]?.[0]).toMatchObject({ ratio_to: '2' });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('sem fator, não grava e explica no campo', async () => {
    const user = userEvent.setup();
    show();

    await user.click(screen.getByRole('button', { name: /Aplicar evento/ }));

    expect(applyCorporateEvent).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Cada 1 papel vira')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('recusa da api no preview aparece no lugar do efeito', async () => {
    const user = userEvent.setup();
    previewCorporateEvent.mockRejectedValue(
      new Error('Nenhuma carteira tinha posição no ativo na data-com do evento'),
    );
    show();

    await user.type(screen.getByLabelText('Cada 1 papel vira'), '2');

    expect(await screen.findByRole('alert')).toHaveTextContent(/posição/);
  });
});
